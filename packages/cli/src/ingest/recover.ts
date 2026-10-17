import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  findContentByHash,
  insertFileGroup,
  insertLibraryFile,
  recordEvent,
  setSourceFileState,
} from '@file-seiri/ledger';
import { hashFile } from '../hash/index.ts';
import { COPY_START, parseCopyIntent } from './copy-events.ts';
import type { WriteTransaction } from './transaction.ts';

type DanglingRow = {
  runId: number;
  sourceFileId: number | null;
  message: string;
};

export type RecoverEnvironment = {
  db: Database;
  write: WriteTransaction;
  libraryRoot: string;
  now: () => Date;
};

/**
 * 前の実行が、異常終了で、台帳に記録できなかったコピーを、見つけて採用する(起動時に行う)。
 *
 * コピーは、ファイルが先で、台帳が後。コピーの前に、`COPY_START`(保存先・ハッシュなどの意図)を記録するため、
 * 「`COPY_START` があるのに、`library_files` にない」ものが、記録の抜けの候補になる。
 * 保存先に、そのファイルが実在し、サイズとハッシュが意図と一致すれば、台帳に記録する(`library_files`・状態を `done`)。
 * 一致しないものは、触らない(別のファイルかもしれない)。コピーが失敗して、一時ファイルを消したものは、保存先にないため、対象にならない。
 * 採用しなければ、次の実行が、同じ内容を別の名前(`_01`)で、重ねてコピーしてしまう。
 * @returns 採用したファイルの数
 */
export const recoverUnrecordedCopies = async (
  environment: RecoverEnvironment
): Promise<number> => {
  const { db, write, libraryRoot, now } = environment;
  const dangling = db
    .query<DanglingRow, [string]>(
      `SELECT e.run_id AS runId, e.source_file_id AS sourceFileId, e.message AS message
       FROM events AS e JOIN runs AS r ON r.run_id = e.run_id
       WHERE e.code = ? AND r.is_dry_run = 0
         AND NOT EXISTS (
           SELECT 1 FROM library_files AS l
           WHERE l.rel_path = json_extract(e.message, '$.dest') COLLATE NOCASE
         )
       ORDER BY e.event_id`
    )
    .all(COPY_START);

  let adopted = 0;
  for (const row of dangling) {
    const intent = parseCopyIntent(row.message);
    if (!intent) continue;
    const path = join(libraryRoot, intent.dest);
    if (!existsSync(path) || statSync(path).size !== intent.sizeBytes) continue;
    const content = findContentByHash(db, intent.hash);
    if (!content) continue;
    if ((await hashFile(path)).hash !== intent.hash) continue;

    write(() => {
      const groupId = insertFileGroup(db, {
        stem: intent.stem,
        bucket: intent.bucket,
      });
      insertLibraryFile(db, {
        contentId: content.contentId,
        groupId,
        runId: row.runId,
        relPath: intent.dest,
        bucket: intent.bucket,
        createdAt: now(),
      });
      if (row.sourceFileId !== null)
        setSourceFileState(db, row.sourceFileId, 'done');
      recordEvent(db, {
        runId: row.runId,
        sourceFileId: row.sourceFileId ?? undefined,
        level: 'INFO',
        code: 'COPY_RECOVERED',
        message: `${intent.src} → ${intent.dest}(前の実行が、記録する前に止まったため、保存先のファイルを採用しました)`,
        occurredAt: now(),
      });
    });
    adopted += 1;
  }
  return adopted;
};
