import { existsSync } from 'node:fs';
import {
  createSnapshot,
  finishRun,
  incrementRevision,
  recordEvent,
  startRun,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { cleanupAppleDouble, usesAppleDouble } from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { openLibraryForIngest } from '../ingest/library.ts';
import { acquireLockSession } from '../ingest/lock-session.ts';
import { chooseLibraryRoot } from '../library/choose.ts';
import { exportRunLog } from '../log/export.ts';
import { runThumbnailStage } from '../thumbs/index.ts';
import { recordVolume } from '../volume/index.ts';

export type ThumbsArguments = {
  library: string | undefined;
  restoreSnapshot: boolean;
};

/**
 * `file-seiri thumbs [--library <パス>]`: サムネイルのないファイルに、サムネイルを作る(既存のライブラリ用)。
 * 何度でも実行できる(あるものは、飛ばす)。止めても(Ctrl-C)、次の実行が、残りから続ける。
 * ファイルは、読むだけ(ライブラリの写真・動画は、変えない)。書き込みのロックを取る(取り込みと同時に走らせない)。
 * 終了コード: 0 すべて作れた / 1 作れなかったものがある / 2 実行できなかった / 130 中断
 */
export const thumbsCommand = async (
  context: CommandContext,
  args: ThumbsArguments
): Promise<ExitCode> => {
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
        kind: 'thumbs',
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
      lock.transaction(() => {
        recordEvent(db, {
          runId,
          level,
          code,
          message,
          occurredAt: context.now(),
        });
      });
    log('INFO', 'RUN_START', `サムネイルの作成を始めます: ${root}`);
    context.stdout(`サムネイル: ${root}`);

    const stopRequested = (): boolean => context.shouldStop() || lock.isLost();
    const report = await runThumbnailStage({
      context,
      library,
      write: (work) => lock.transaction(work),
      mediaKind: libraryVolume.mediaKind,
      stopRequested,
      log,
    });

    // ロックを失ったときは、台帳に書かない(別の実行が、引き継いでいる)
    if (lock.isLost()) {
      context.stderr(
        'ロックを失ったため、止めました(結果は、台帳に記録していません)。'
      );
      return EXIT_CODES.failed;
    }

    const status = report.stopped ? 'interrupted' : 'completed';
    lock.transaction(() => {
      log('INFO', 'RUN_END', `サムネイルの作成を終えました(${status})`);
      const revision = incrementRevision(db);
      finishRun(db, runId, {
        status,
        finishedAt: context.now(),
        revisionAfter: revision,
      });
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
      context.stdout(
        '中断しました(Ctrl-C)。もう一度実行すると、残りから続けます。'
      );
      return EXIT_CODES.interrupted;
    }
    return report.failed + report.copyFailed > 0 || snapshotFailed
      ? EXIT_CODES.completedWithErrors
      : EXIT_CODES.ok;
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
