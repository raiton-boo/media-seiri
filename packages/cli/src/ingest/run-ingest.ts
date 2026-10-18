import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WriteLock } from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import {
  cleanupAppleDouble,
  cleanupPartFiles,
  usesAppleDouble,
} from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { createMetadataReader } from '../metadata/index.ts';
import {
  type IngestOptions,
  type IngestSession,
  ingestSource,
} from './ingest-source.ts';
import { openLibraryForIngest } from './library.ts';
import { acquireLockSession } from './lock-session.ts';
import { checkDestinationVolume } from './preflight.ts';
import { recoverUnrecordedCopies } from './recover.ts';

export type { IngestOptions } from './ingest-source.ts';

/**
 * `ingest` を実行する。ソースは、1 つずつ順番に処理する(同じハブの USB の帯域を奪い合わないため。仕様書 §9-1)。
 * 終了コードは、ソースごとの結果のうち、いちばん重いもの(130 は、中断として、最優先)。
 *
 * 本実行は、書き込みのロックを取る(取れなければ、保持者を表示して、すぐ終了。仕様書 §12)。
 * ロックが途絶えていれば、引き継ぎ、前の実行を中断として記録する。起動時に、残った一時ファイルを消し、
 * 前の実行が、記録する前に止まったコピーを、見つけて採用する。dry-run は、ロックを取らない(読み取りだけのため)。
 */
export const runIngest = async (
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
  let lock: WriteLock | undefined;
  let stopHeartbeat = (): void => {};
  try {
    const session: IngestSession = {
      context,
      library,
      destinationVolume,
      metadataReader,
      options,
      write: (work) => library.ledger.transaction(work),
      lock: undefined,
      takeover: undefined,
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
    for (const source of options.sources) {
      const code = await ingestSource(session, source);
      if (code === EXIT_CODES.interrupted) return code;
      if (code > worst) worst = code;
      // ロックを失ったら、ほかのソースには、進まない
      if (lock?.isLost()) break;
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
    lock?.release();
    await metadataReader.close();
    library.ledger.close();
  }
};
