import { existsSync } from 'node:fs';
import {
  createSnapshot,
  getRevision,
  incrementRevision,
} from '@file-seiri/ledger';
import { rebuildAlbumEvents } from '../album/rebuild.ts';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { cleanupAppleDouble, usesAppleDouble } from '../copy/index.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { openLibraryForIngest } from '../ingest/library.ts';
import { acquireLockSession } from '../ingest/lock-session.ts';
import { chooseLibraryRoot } from '../library/choose.ts';
import { showReport } from '../present/index.ts';

export type EventsArguments = {
  library: string | undefined;
  restoreSnapshot: boolean;
};

/**
 * `file-seiri events [--library <パス>]`: アルバムのできごとを、全体、計算し直す(仕様書 §16-6)。
 * 取り込みの最後に、自動で計算されるため、ふだんは要らない。できごとの計算ができる前に取り込んだライブラリや、
 * 計算の規則を変えたあとに、使う。写真・動画は、読むだけ(変えない)。台帳に書くため、書き込みのロックを取り、
 * リビジョンを +1 して、スナップショットを保存する(実行の記録は、作らない)。
 * 終了コード: 0 / 2 実行できなかった
 */
export const eventsCommand = async (
  context: CommandContext,
  args: EventsArguments
): Promise<ExitCode> => {
  const root = await chooseLibraryRoot(context, args.library);
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
    const result = lock.transaction(() => {
      const revision = incrementRevision(db);
      return { ...rebuildAlbumEvents(db, revision), revision };
    });
    if (context.fancy) {
      showReport(context, {
        title: 'アルバムのできごと',
        badge: { label: '完了', tone: 'ok' },
        sections: [
          {
            title: '計算の結果',
            tone: 'ok',
            rows: [
              { label: 'できごと', value: `${result.events} 件`, tone: 'ok' },
              { label: '対象の写真', value: `${result.files} 枚` },
              {
                label: 'リビジョン',
                value: String(getRevision(db)),
                tone: 'dim',
              },
            ],
          },
        ],
      });
    } else {
      context.stdout(
        `アルバムのできごとを計算しました: ${result.events} 件(対象 ${result.files} 枚。リビジョン ${getRevision(db)})`
      );
    }
    try {
      createSnapshot(library.ledger, library.snapshotPath);
    } catch (error) {
      context.stderr(
        `警告: スナップショットを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`
      );
      return EXIT_CODES.completedWithErrors;
    }
    return EXIT_CODES.ok;
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
