import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WriteLock } from '@file-seiri/ledger';
import cliPackage from '../../package.json' with { type: 'json' };
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import {
  cleanupAppleDouble,
  cleanupPartFiles,
  usesAppleDouble,
} from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { terminalColumns } from '../live/terminal-size.ts';
import { createMetadataReader } from '../metadata/index.ts';
import { renderReport } from '../present/report-view.tsx';
import { formatTotals, totalsReport } from '../present/summary-report.ts';
import { installViewerBundle } from '../viewer-bundle/install.ts';
import {
  type IngestOptions,
  type IngestSession,
  ingestSource,
} from './ingest-source.ts';
import { openLibraryForIngest } from './library.ts';
import { acquireLockSession } from './lock-session.ts';
import { checkDestinationVolume } from './preflight.ts';
import { recoverUnrecordedCopies } from './recover.ts';
import { dropOverlappingSources } from './sources.ts';

export type { IngestOptions } from './ingest-source.ts';

/** 進み具合だけを伝える行(ライブ表示では、画面に出ているので、あとで、出し直さない) */
const PROGRESS_LINE =
  /^\s*(解析|コピー|サムネイル): \d+ \/ \d+$|^スキャン: |^コピー: \d+ ファイル/;

/** ライブ表示(画面を書き換える表示)を使うか: 端末(質問できる状態)で、`--plain` でないとき */
const useLiveDisplay = (
  context: CommandContext,
  options: IngestOptions
): boolean => !options.plain && context.isInteractive;

/** ビューアの実行ファイル一式が見つかれば、ライブラリの viewer/ へ置く。失敗は、警告だけ */
const placeViewer = (context: CommandContext, libraryRoot: string): void => {
  if (!context.viewerBundleDir) return;
  try {
    const result = installViewerBundle({
      bundleDir: context.viewerBundleDir,
      libraryRoot,
      version: cliPackage.version,
    });
    if (result && result.installed.length > 0) {
      context.stdout(
        `ビューアを、ドライブに置きました: ${result.directory}(${result.installed.length} ファイル)`
      );
    }
  } catch (error) {
    context.stderr(
      `警告: ビューアを、ドライブに置けませんでした: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * `ingest` を実行する。ソースは、1 つずつ順番に処理する(同じハブの USB の帯域を奪い合わないため。仕様書 §9-1)。
 * 終了コードは、ソースごとの結果のうち、いちばん重いもの(130 は、中断として、最優先)。
 *
 * 本実行は、書き込みのロックを取る(取れなければ、保持者を表示して、すぐ終了。仕様書 §12)。
 * ロックが途絶えていれば、引き継ぎ、前の実行を中断として記録する。起動時に、残った一時ファイルを消し、
 * 前の実行が、記録する前に止まったコピーを、見つけて採用する。dry-run は、ロックを取らない(読み取りだけのため)。
 */
const runIngestInner = async (
  context: CommandContext,
  options: IngestOptions
): Promise<ExitCode> => {
  // 保存先の検査を、先に行う(使えないドライブには、ライブラリを作らない)
  const destinationRoot = resolve(options.destination);
  if (!existsSync(destinationRoot)) {
    throw new CliError(`保存先がありません: ${destinationRoot}`);
  }
  const destinationVolume = context.resolveVolume(destinationRoot);
  const problems = checkDestinationVolume(destinationVolume);
  if (problems.length > 0) {
    for (const problem of problems)
      context.stderr(`エラー(${problem.code}): ${problem.message}`);
    return EXIT_CODES.failed;
  }
  const library = await openLibraryForIngest(context, options.destination, {
    restoreSnapshot: options.restoreSnapshot,
  });
  const metadataReader = createMetadataReader();
  const repairTools = context.repairTools();
  let lock: WriteLock | undefined;
  let stopHeartbeat = (): void => {};
  try {
    const session: IngestSession = {
      context,
      library,
      destinationVolume,
      metadataReader,
      repairTools,
      options,
      write: (work) => library.ledger.transaction(work),
      lock: undefined,
      takeover: undefined,
      collected: [],
    };

    if (!options.dryRun) {
      const acquired = acquireLockSession(context, library.ledger);
      if (!acquired) return EXIT_CODES.failed;
      lock = acquired.lock;
      stopHeartbeat = acquired.stopHeartbeat;
      session.lock = lock;
      session.write = (work) => (lock as WriteLock).transaction(work);
      session.takeover = acquired.takeover;
      const cleaned = cleanupPartFiles(library.root);
      if (cleaned.removed.length > 0)
        context.stdout(
          `前の実行が残した一時ファイルを、${cleaned.removed.length} 件、削除しました。`
        );
      for (const path of cleaned.failed)
        context.stderr(`警告: 一時ファイルを削除できませんでした: ${path}`);
      const recovered = await recoverUnrecordedCopies({
        db: library.ledger.db,
        write: session.write,
        libraryRoot: library.root,
        now: context.now,
      });
      if (recovered > 0)
        context.stdout(
          `前の実行が、記録する前に止まったコピーを、${recovered} 件、採用しました。`
        );
    }

    let worst: ExitCode = EXIT_CODES.ok;
    // ほかの取り込み元の中にある取り込み元は、同じファイルを 2 度読むだけなので、外す
    const { kept: sources, dropped } = dropOverlappingSources(options.sources);
    for (const { source, parent } of dropped) {
      context.stderr(
        `警告: ${source} は、${parent} と重なるため、取り込み元から外しました(${parent} の中に、含まれます)。`
      );
    }
    for (const [index, source] of sources.entries()) {
      const code = await ingestSource(session, source, {
        index,
        count: sources.length,
      });
      if (code === EXIT_CODES.interrupted) return code;
      if (code > worst) worst = code;
      // ロックを失ったら、ほかのソースには、進まない
      if (lock?.isLost()) break;
    }
    // 本実行の最後に、閲覧専用ビューアを、ドライブの viewer/ へ置く(置けなくても、取り込みは、成功のまま)
    if (!options.dryRun && !lock?.isLost()) {
      placeViewer(context, library.root);
    }
    if (session.collected.length > 1) {
      if (context.fancy) {
        const columns = terminalColumns();
        const text = renderReport(
          totalsReport(session.collected, options.dryRun),
          columns
        );
        if (context.report) context.report([text]);
        else context.stdout(text);
      } else {
        const lines = formatTotals(session.collected, options.dryRun);
        if (context.report) context.report(lines);
        else for (const line of lines) context.stdout(line);
      }
    }
    return worst;
  } finally {
    stopHeartbeat();
    // exFAT・FAT の保存先に、macOS が作った付属ファイル(`._名前`)を、掃除する(仕様書 §7-4)。
    // スナップショットの保存のあとに、行う。ロックを持っているうちに行う(書き込みの一部のため)
    if (lock && !lock.isLost() && usesAppleDouble(destinationVolume.fsType)) {
      try {
        const swept = cleanupAppleDouble(library.root);
        for (const path of swept.failed) {
          context.stderr(`警告: 付属ファイルを削除できませんでした: ${path}`);
        }
      } catch (error) {
        context.stderr(
          `警告: 付属ファイルを掃除できませんでした: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    // 画面が、閉じた台帳を読まないよう、先に伝える
    context.progress.end();
    lock?.release();
    await metadataReader.close();
    await repairTools.close();
    library.ledger.close();
  }
};

/**
 * `ingest` を実行する。端末なら、btop 風のライブ表示を出す(`--plain`・端末でないときは、ログの行だけ)。
 * ライブ表示の間、取り込みが標準出力・標準エラーに出す行は、画面のログの欄へ(画面が崩れないように)。
 * 結果のまとめ(サマリー)と、警告は、画面を閉じてから、まとめて出す。コピーの前の確認の質問のときは、画面を、いったん閉じる。
 */
export const runIngest = async (
  context: CommandContext,
  options: IngestOptions
): Promise<ExitCode> => {
  if (!useLiveDisplay(context, options))
    return runIngestInner(context, options);

  const live = context.liveController();
  const reported: string[] = [];
  const warnings: string[] = [];
  const flush = (): void => {
    for (const line of reported.splice(0)) context.stdout(line);
    for (const line of warnings.splice(0)) context.stderr(line);
  };
  const liveContext: CommandContext = {
    ...context,
    progress: live.feed,
    pause: live.pause,
    shouldStop: () => context.shouldStop() || live.stopRequested(),
    // 画面の邪魔にならないよう、いったん、ためる。進み具合の行は、画面に出ているので、あとで出さない
    stdout: (text) => {
      live.note(text);
      if (!PROGRESS_LINE.test(text)) reported.push(text);
    },
    stderr: (text) => {
      live.note(text);
      warnings.push(text);
    },
    report: (lines) => {
      reported.push(...lines);
    },
    confirm: async (question) => {
      await live.suspend();
      flush();
      const answer = await context.confirm(question);
      live.resume();
      return answer;
    },
  };
  live.start();
  try {
    return await runIngestInner(liveContext, options);
  } finally {
    await live.stop();
    flush();
  }
};
