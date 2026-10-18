import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSnapshot,
  finishRun,
  incrementRevision,
  type LockInfo,
  LockLostError,
  listUnfinishedRuns,
  recordEvent,
  recordRunCapacity,
  resumeRun,
  startRun,
  type WriteLock,
} from '@file-seiri/ledger';
import { rebuildAlbumEvents } from '../album/rebuild.ts';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { exportRunLog } from '../log/export.ts';
import type { MetadataReader } from '../metadata/index.ts';
import { collectScan } from '../scan/index.ts';
import { runThumbnailStage } from '../thumbs/index.ts';
import { recordVolume, type VolumeInfo } from '../volume/index.ts';
import { type AnalyzeEnvironment, analyzeFile } from './analyze.ts';
import { mapConcurrent, readConcurrency } from './concurrency.ts';
import { executeCopies } from './copy-stage.ts';
import type { OpenedLibrary } from './library.ts';
import { buildPlan } from './plan.ts';
import {
  assertDifferentVolumes,
  capacityProblem,
  checkFat32Limit,
  estimateCapacity,
  type Problem,
} from './preflight.ts';
import { recordPlan } from './record.ts';
import { recordScan, tally } from './scan-record.ts';
import {
  describeVolume,
  emptySummary,
  formatCopyResult,
  formatSummary,
  type IngestSummary,
  type StopReason,
} from './summary.ts';
import type { WriteTransaction } from './transaction.ts';

const PROGRESS_INTERVAL = 1000;

export type IngestOptions = {
  sources: string[];
  destination: string;
  dryRun: boolean;
  rehash: boolean;
  restoreSnapshot: boolean;
  /** 中断した実行を、同じ実行 ID で続ける(本実行のみ) */
  resume: boolean;
  /** コピーの前の確認を、省く */
  yes: boolean;
};

/** ソースを処理するための、実行全体で共有するもの */
export type IngestSession = {
  context: CommandContext;
  library: OpenedLibrary;
  destinationVolume: VolumeInfo;
  metadataReader: MetadataReader;
  options: IngestOptions;
  write: WriteTransaction;
  /** 本実行のロック(dry-run では、undefined) */
  lock: WriteLock | undefined;
  /** ロックを引き継いだときの、前の保持者。最初のソースの実行に、記録する */
  takeover: { previous: LockInfo; interruptedRuns: number[] } | undefined;
};

/** 解析の途中で、中断の要求(Ctrl-C・ロックを失った)を受けた */
class StopRequested extends Error {
  constructor(readonly reason: StopReason) {
    super(`中断: ${reason}`);
  }
}

const printLines = (
  context: CommandContext,
  lines: readonly string[]
): void => {
  for (const line of lines) context.stdout(line);
};

/**
 * 1 つのソースを、取り込む。dry-run は、コピーの手前まで(保存先には、書かない)。
 * 本実行は、計画のあと、確認(端末で、`--yes` がなければ)→ コピー → リビジョン +1 → スナップショット。
 * 終了コード: 0 正常 / 1 エラーのファイルあり / 2 実行できなかった / 130 中断(Ctrl-C)
 */
export const ingestSource = async (
  session: IngestSession,
  source: string
): Promise<ExitCode> => {
  const {
    context,
    library,
    destinationVolume,
    metadataReader,
    options,
    write,
    lock,
  } = session;
  const { db } = library.ledger;
  const sourceRoot = resolve(source);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new CliError(`ソースのフォルダがありません: ${sourceRoot}`);
  }
  const sourceVolume = context.resolveVolume(sourceRoot);
  assertDifferentVolumes(sourceVolume, destinationVolume);

  const volume = write(() => recordVolume(db, sourceVolume, context.now()));
  const unfinished = listUnfinishedRuns(db, volume.volumeId).filter(
    (run) => !run.isDryRun
  );
  let runId: number;
  if (options.resume) {
    const target = unfinished[0];
    if (!target) {
      throw new CliError(
        '再開できる実行がありません(このソースに、中断した実行がありません)。--resume を外して、新しく実行してください。'
      );
    }
    write(() => resumeRun(db, target.runId));
    runId = target.runId;
  } else {
    if (!options.dryRun && unfinished.length > 0) {
      context.stdout(
        `注意: 中断した実行があります(実行 ${unfinished.map((run) => run.runId).join('、')})。続きから行うには --resume を付けます。いまは、新しい実行として始めます(処理済みのファイルは、二重にコピーしません)。`
      );
    }
    runId = write(() =>
      startRun(db, {
        sourceVolumeId: volume.volumeId,
        isDryRun: options.dryRun,
        startedAt: context.now(),
      })
    );
  }

  const log = (
    level: 'INFO' | 'WARN' | 'ERROR',
    code: string,
    message: string
  ): void => {
    write(() =>
      recordEvent(db, {
        runId,
        level,
        code,
        message,
        occurredAt: context.now(),
      })
    );
  };
  const label = options.dryRun ? 'dry-run' : '取り込み';
  log(
    'INFO',
    options.resume ? 'RUN_RESUME' : 'RUN_START',
    `${label}を${options.resume ? '再開' : '始め'}ます: ${sourceRoot}`
  );
  if (session.takeover) {
    const { previous, interruptedRuns } = session.takeover;
    log(
      'WARN',
      'LOCK_TAKEOVER',
      `ハートビートが途絶えたロック(保持者 ${previous.holder}、最後の更新 ${previous.heartbeatAt})を引き継ぎました。前の実行 ${interruptedRuns.join('、') || 'なし'} を中断として記録しました`
    );
    session.takeover = undefined;
  }

  const summary = emptySummary();
  const stopRequested = (): StopReason | undefined => {
    if (lock?.isLost()) return 'lock-lost';
    return context.shouldStop() ? 'user' : undefined;
  };

  /** 実行を終える: リビジョン +1・状態・イベントを記録 → スナップショット(本実行のみ) */
  const conclude = (
    status: 'completed' | 'interrupted' | 'failed'
  ): { snapshotFailed: boolean } => {
    write(() => {
      const revision = incrementRevision(db);
      finishRun(db, runId, {
        status,
        finishedAt: context.now(),
        revisionAfter: revision,
      });
      // アルバムのできごとを、全体、計算し直す(本実行のみ。仕様書 §16-6)。リビジョンの記録と、同じトランザクション
      if (!options.dryRun) {
        const album = rebuildAlbumEvents(db, revision);
        log(
          'INFO',
          'ALBUM_EVENTS',
          `アルバムのできごとを計算しました: ${album.events} 件(対象 ${album.files} 枚)`
        );
      }
      log('INFO', 'RUN_END', `${label}を終えました(${status})`);
    });
    // ログのファイル(実行ごとに 1 つ)。書き出せなくても、台帳には残っているため、警告だけ(要件 L-02)
    try {
      exportRunLog({
        db,
        dataDir: context.dataDir,
        libraryId: library.libraryId,
        runId,
        timeZone: context.timeZone,
      });
    } catch (error) {
      context.stderr(
        `警告: ログファイルを書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (options.dryRun) return { snapshotFailed: false };
    try {
      createSnapshot(library.ledger, library.snapshotPath);
      return { snapshotFailed: false };
    } catch (error) {
      context.stderr(
        `警告: スナップショットを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
      return { snapshotFailed: true };
    }
  };

  /** 中断の理由ごとの、終え方と終了コード */
  const stopped = (reason: StopReason): ExitCode => {
    if (summary.copy) summary.copy.stopReason = reason;
    // ロックを失ったときは、台帳に書かない(別の実行が、引き継いでいる)
    if (reason === 'lock-lost') return EXIT_CODES.failed;
    conclude('interrupted');
    return reason === 'user' ? EXIT_CODES.interrupted : EXIT_CODES.failed;
  };

  try {
    context.stdout(`スキャン: ${sourceRoot}`);
    const scan = collectScan({
      sourceRoot,
      volume: sourceVolume,
      excludePaths: [library.root, context.dataDir],
    });
    const { rows } = recordScan({
      db,
      write,
      runId,
      volumeId: volume.volumeId,
      scan,
      now: context.now,
      summary,
      resume: options.resume,
    });
    context.stdout(
      `  ${scan.files.length + scan.emptyFiles.length} ファイルを見つけました(解析する対象: ${rows.length})`
    );

    const jsonNamesByDirectory = new Map<string, Set<string>>();
    for (const file of scan.files) {
      if (file.kind !== 'json') continue;
      const names =
        jsonNamesByDirectory.get(file.directory) ?? new Set<string>();
      names.add(file.fileName);
      jsonNamesByDirectory.set(file.directory, names);
    }
    const analyzeEnvironment: AnalyzeEnvironment = {
      db,
      volumeId: volume.volumeId,
      metadataReader,
      dateOptions: { now: context.now(), timeZone: context.timeZone },
      rehash: options.rehash,
      now: context.now,
      jsonNamesByDirectory,
    };
    let analyzed = 0;
    const analyses = await mapConcurrent(
      rows,
      readConcurrency(sourceVolume.mediaKind),
      async ({ file, sourceFileId }) => {
        const reason = stopRequested();
        if (reason) throw new StopRequested(reason);
        const analysis = await analyzeFile(
          file,
          sourceFileId,
          analyzeEnvironment
        );
        analyzed += 1;
        if (analyzed % PROGRESS_INTERVAL === 0)
          context.stdout(`  解析: ${analyzed} / ${rows.length}`);
        return analysis;
      }
    );

    const plan = buildPlan(analyses, { db, libraryRoot: library.root });
    tally(analyses, plan, summary);
    summary.sequencedGroups = plan.sequencedGroups;
    const problems: Problem[] = checkFat32Limit(
      destinationVolume,
      analyses.flatMap((analysis, index) =>
        plan.files[index]?.action === 'copy' ? [analysis.file.sizeBytes] : []
      )
    );
    summary.capacity = estimateCapacity(
      summary.copyBytes,
      destinationVolume.freeBytes
    );
    // 容量の見積りを、実行に残す(dry-run の結果の画面で、あとから、足りていたかを見られるように)
    write(() =>
      recordRunCapacity(db, runId, {
        requiredBytes: summary.capacity?.requiredBytes ?? 0,
        destinationFreeBytes: summary.capacity?.freeBytes ?? 0,
      })
    );
    const shortage = capacityProblem(summary.capacity);
    if (shortage) problems.push(shortage);
    summary.problems = problems;

    recordPlan(
      { db, write, runId, now: context.now, isDryRun: options.dryRun },
      analyses,
      plan
    );

    const exitFor = (): ExitCode =>
      summary.problems.length > 0
        ? EXIT_CODES.failed
        : summary.errorFiles + summary.emptyFiles > 0
          ? EXIT_CODES.completedWithErrors
          : EXIT_CODES.ok;
    const showSummary = (): void =>
      printLines(
        context,
        formatSummary(summary, {
          source: describeVolume(sourceVolume),
          destination: describeVolume(destinationVolume),
          isDryRun: options.dryRun,
        })
      );

    if (options.dryRun) {
      conclude('completed');
      showSummary();
      return exitFor();
    }

    // 本実行: 問題(容量不足・FAT32 の 4 GB など)があれば、コピーせずに止める
    if (summary.problems.length > 0) {
      conclude('failed');
      showSummary();
      return EXIT_CODES.failed;
    }
    showSummary();
    // 実行前の確認(「ソース → 保存先」と、容量の結果を見せたあと)
    if (summary.copyFiles > 0 && context.isInteractive && !options.yes) {
      if (!(await context.confirm('この内容で、コピーを始めますか'))) {
        context.stdout(
          '中止しました(コピーは、していません。--resume で、続きから実行できます)。'
        );
        conclude('interrupted');
        return EXIT_CODES.interrupted;
      }
    }

    if (summary.copyFiles > 0) {
      context.stdout(
        `コピー: ${summary.copyFiles} ファイル(${rows.length > 0 ? '照合つき' : ''})`
      );
    }
    const reason = lock
      ? await executeCopies({
          context,
          library,
          lock,
          runId,
          sourceRoot,
          destinationVolume,
          analyses,
          plan,
          summary,
        })
      : undefined;
    if (summary.copy) printLines(context, formatCopyResult(summary.copy));
    if (reason) return stopped(reason);

    // サムネイル(コピーの最後に、まとめて作る。作れなくても、取り込みは失敗にしない)
    const thumbnails = await runThumbnailStage({
      context,
      library,
      write,
      mediaKind: destinationVolume.mediaKind,
      stopRequested: () => stopRequested() !== undefined,
      log,
    });
    if (thumbnails.stopped) {
      const thumbReason = stopRequested();
      if (thumbReason) return stopped(thumbReason);
    }

    const { snapshotFailed } = conclude('completed');
    const code = exitFor();
    return snapshotFailed && code === EXIT_CODES.ok
      ? EXIT_CODES.completedWithErrors
      : code;
  } catch (error) {
    if (error instanceof StopRequested) {
      if (summary.copy) summary.copy.stopReason = error.reason;
      context.stdout(
        error.reason === 'user'
          ? '中断しました(解析の途中)。--resume で、続きから実行できます。'
          : '中断しました。'
      );
      return stopped(error.reason);
    }
    // 予期しない失敗: 実行を failed にして、エラーを伝える(ロックを失っていれば、台帳には書かない)
    try {
      conclude('failed');
    } catch (concludeError) {
      if (!(concludeError instanceof LockLostError)) throw concludeError;
    }
    throw error;
  }
};

export type { IngestSummary };
