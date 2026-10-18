import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createSnapshot,
  finishRun,
  incrementRevision,
  recordError,
  recordEvent,
  startRun,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import {
  COPY_CHUNK_BYTES,
  cleanupAppleDouble,
  hashWithoutCache,
  usesAppleDouble,
} from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { readConcurrency } from '../ingest/concurrency.ts';
import { openLibraryForIngest } from '../ingest/library.ts';
import { acquireLockSession } from '../ingest/lock-session.ts';
import { formatBytes } from '../ingest/preflight.ts';
import { parseSampleRatio } from '../verify/sample.ts';
import {
  type FileProblem,
  type VerifyReport,
  verifyLibrary,
} from '../verify/verify-library.ts';
import { recordVolume } from '../volume/index.ts';

export type VerifyArguments = {
  library: string | undefined;
  sample: string | undefined;
  restoreSnapshot: boolean;
};

/** 問題のファイルを、画面に出す最大の数(全件は、エラー一覧に記録する) */
const SHOWN_PROBLEMS = 20;

/** `--library` の指定、または、この Mac に登録されたライブラリが 1 つだけならそれ */
const chooseLibraryRoot = (
  context: CommandContext,
  option: string | undefined
): string => {
  if (option) return resolve(option);
  const registered = Object.entries(readConfig(context.dataDir).libraries);
  const [only, ...others] = registered;
  if (!only) {
    throw new CliError(
      'この Mac に登録されたライブラリがありません。--library <ライブラリの根> で指定してください。'
    );
  }
  if (others.length > 0) {
    const list = registered
      .map(([id, entry]) => `  ${id.slice(0, 8)}  ${entry.root}`)
      .join('\n');
    throw new CliError(
      `ライブラリが複数あります。--library <ライブラリの根> で指定してください。\n${list}`
    );
  }
  return only[1].root;
};

const printProblems = (
  context: CommandContext,
  title: string,
  problems: readonly FileProblem[]
): void => {
  if (problems.length === 0) return;
  context.stdout('');
  context.stdout(`${title}(${problems.length} 件):`);
  for (const problem of problems.slice(0, SHOWN_PROBLEMS))
    context.stdout(`  ${problem.relPath}: ${problem.detail}`);
  if (problems.length > SHOWN_PROBLEMS) {
    context.stdout(
      `  ほか ${problems.length - SHOWN_PROBLEMS} 件(全件は、エラー一覧に記録しました)`
    );
  }
};

const printReport = (
  context: CommandContext,
  report: VerifyReport,
  root: string,
  sampleRatio: number,
  seconds: number
): void => {
  const sampled =
    sampleRatio < 1 ? `(抜き取り ${report.checked} 件を検査)` : '';
  context.stdout(`${report.stopped ? '[中断] ' : ''}検査の結果: ${root}`);
  context.stdout(`  台帳のファイル: ${report.ledgerFiles} 件${sampled}`);
  context.stdout(`  一致: ${report.matched} 件`);
  context.stdout(`  不一致: ${report.mismatched.length} 件`);
  context.stdout(
    `  欠落: ${report.missing.length} 件(台帳にあるが、ファイルがない)`
  );
  context.stdout(`  読み取り不可: ${report.unreadable.length} 件`);
  context.stdout(
    report.stopped
      ? '  未登録: (中断したため、調べていません)'
      : `  未登録: ${report.unregistered.length} 件(ファイルはあるが、台帳にない。報告のみ)`
  );
  // 速さは、読んだ量があり、ある程度の時間がかかったときだけ表示する(「0 B/秒」のような表示を避ける)
  const rate =
    report.bytesRead > 0 && seconds >= 0.1
      ? ` / ${formatBytes(report.bytesRead / seconds)}/秒`
      : '';
  context.stdout(
    `  読んだ量: ${formatBytes(report.bytesRead)}(${seconds.toFixed(1)} 秒${rate})`
  );
  if (report.ledgerFiles === 0) {
    context.stdout(
      '  ※ 台帳に、ライブラリのファイルがありません(まだ取り込んでいない、または、別のライブラリを指していませんか)。'
    );
  }
  printProblems(context, '不一致', report.mismatched);
  printProblems(context, '欠落', report.missing);
  printProblems(context, '読み取り不可', report.unreadable);
  if (!report.stopped && report.unregistered.length > 0) {
    context.stdout('');
    context.stdout(`未登録(${report.unregistered.length} 件):`);
    for (const relPath of report.unregistered.slice(0, SHOWN_PROBLEMS))
      context.stdout(`  ${relPath}`);
    if (report.unregistered.length > SHOWN_PROBLEMS) {
      context.stdout(
        `  ほか ${report.unregistered.length - SHOWN_PROBLEMS} 件(全件は、イベントに記録しました)`
      );
    }
  }
};

/**
 * `file-seiri verify [--library <パス>] [--sample <割合>]`: ライブラリの全ファイルを読み直して、台帳と照合する(`hash-verify.md` §6)。
 * ファイルは、修復も削除もしない。検査も「実行」として台帳に記録する(不一致・欠落は、`VERIFY_MISMATCH`)。
 * 書き込みのロックを取る(取り込みと同時に走らせると、結果が食い違うため)。
 * 終了コード: 0 すべて一致(未登録だけなら 0)/ 1 不一致・欠落・読み取り不可あり / 2 実行できなかった / 130 中断
 */
export const verifyCommand = async (
  context: CommandContext,
  args: VerifyArguments
): Promise<ExitCode> => {
  const sampleRatio =
    args.sample === undefined ? 1 : parseSampleRatio(args.sample);
  const root = chooseLibraryRoot(context, args.library);
  if (!existsSync(root)) {
    throw new CliError(
      `ライブラリが見つかりません(ドライブが、接続されていますか): ${root}`
    );
  }
  const libraryVolume = context.resolveVolume(root);
  const library = await openLibraryForIngest(context, root, {
    restoreSnapshot: args.restoreSnapshot,
    createIfMissing: false,
  });
  const session = acquireLockSession(context, library.ledger);
  if (!session) {
    library.ledger.close();
    return EXIT_CODES.failed;
  }
  const { lock } = session;
  const { db } = library.ledger;
  try {
    const volume = lock.transaction(() =>
      recordVolume(db, libraryVolume, context.now())
    );
    const runId = lock.transaction(() =>
      startRun(db, {
        kind: 'verify',
        sourceVolumeId: volume.volumeId,
        isDryRun: false,
        startedAt: context.now(),
      })
    );
    const log = (
      level: 'INFO' | 'WARN' | 'ERROR',
      code: string,
      message: string
    ): void =>
      void recordEvent(db, {
        runId,
        level,
        code,
        message,
        occurredAt: context.now(),
      });
    lock.transaction(() => {
      log(
        'INFO',
        'RUN_START',
        `検査を始めます: ${root}${sampleRatio < 1 ? `(抜き取り ${Math.round(sampleRatio * 100)}%)` : ''}`
      );
    });

    context.stdout(
      `検査: ${root}${sampleRatio < 1 ? `(抜き取り ${Math.round(sampleRatio * 100)}%)` : ''}`
    );
    const startedAt = Date.now();
    const report = await verifyLibrary({
      db,
      libraryRoot: root,
      hashFile: (path) => hashWithoutCache(path, COPY_CHUNK_BYTES),
      concurrency: readConcurrency(libraryVolume.mediaKind),
      sampleRatio,
      random: context.random,
      shouldStop: () => context.shouldStop() || lock.isLost(),
      onProgress: (checked, total) =>
        context.stdout(`  検査: ${checked} / ${total}`),
    });
    const seconds = (Date.now() - startedAt) / 1000;
    printReport(context, report, root, sampleRatio, seconds);

    // ロックを失ったときは、台帳に書かない(別の実行が、引き継いでいる)
    if (lock.isLost()) {
      context.stderr(
        'ロックを失ったため、検査を止めました(結果は、台帳に記録していません)。'
      );
      return EXIT_CODES.failed;
    }

    lock.transaction(() => {
      const at = context.now();
      for (const problem of [...report.mismatched, ...report.missing]) {
        recordError(db, {
          runId,
          code: 'VERIFY_MISMATCH',
          detail: `${problem.relPath}: ${problem.detail}`,
          occurredAt: at,
        });
      }
      for (const problem of report.unreadable) {
        recordError(db, {
          runId,
          code: 'READ_FAILED',
          detail: `${problem.relPath}: ${problem.detail}`,
          occurredAt: at,
        });
      }
      for (const relPath of report.unregistered) {
        log(
          'WARN',
          'VERIFY_UNREGISTERED',
          `${relPath}(ファイルはあるが、台帳にありません)`
        );
      }
      log(
        'INFO',
        'VERIFY_RESULT',
        `検査 ${report.checked} 件: 一致 ${report.matched}・不一致 ${report.mismatched.length}・欠落 ${report.missing.length}・読み取り不可 ${report.unreadable.length}・未登録 ${report.unregistered.length}`
      );
      const revision = incrementRevision(db);
      finishRun(db, runId, {
        status: report.stopped ? 'interrupted' : 'completed',
        finishedAt: context.now(),
        revisionAfter: revision,
      });
    });
    let snapshotFailed = false;
    try {
      createSnapshot(library.ledger, library.snapshotPath);
    } catch (error) {
      snapshotFailed = true;
      context.stderr(
        `警告: スナップショットを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (report.stopped) {
      context.stdout('中断しました(Ctrl-C)。ここまでの結果を記録しました。');
      return EXIT_CODES.interrupted;
    }
    const problems =
      report.mismatched.length +
      report.missing.length +
      report.unreadable.length;
    if (problems > 0) return EXIT_CODES.completedWithErrors;
    return snapshotFailed ? EXIT_CODES.completedWithErrors : EXIT_CODES.ok;
  } finally {
    session.stopHeartbeat();
    // スナップショットのあとに、exFAT・FAT の付属ファイル(`._名前`)を掃除する(仕様書 §7-4)
    if (!lock.isLost() && usesAppleDouble(libraryVolume.fsType)) {
      try {
        for (const path of cleanupAppleDouble(library.root).failed) {
          context.stderr(`警告: 付属ファイルを削除できませんでした: ${path}`);
        }
      } catch (error) {
        context.stderr(
          `警告: 付属ファイルを掃除できませんでした: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    lock.release();
    library.ledger.close();
  }
};
