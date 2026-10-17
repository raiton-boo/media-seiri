import type { Database } from 'bun:sqlite';
import type { Bucket } from '@file-seiri/core';

export type FileGroupRecord = {
  groupId: number;
  /** 出力名の語幹 */
  stem: string;
  bucket: Bucket;
};

/** 同名グループを追加する。ID を返す */
export const insertFileGroup = (
  db: Database,
  input: { stem: string; bucket: Bucket }
): number => {
  const result = db
    .query('INSERT INTO file_groups (stem, bucket) VALUES (?, ?)')
    .run(input.stem, input.bucket);
  return Number(result.lastInsertRowid);
};

export const getFileGroup = (
  db: Database,
  groupId: number
): FileGroupRecord | undefined =>
  db
    .query<FileGroupRecord, [number]>(
      'SELECT group_id AS groupId, stem, bucket FROM file_groups WHERE group_id = ?'
    )
    .get(groupId) ?? undefined;
