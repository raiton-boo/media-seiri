import type { Database } from 'bun:sqlite';
import type { Bucket } from '@file-seiri/core';
import { formatTimestamp } from './time.ts';

export type LibraryFileRecord = {
  libraryFileId: number;
  contentId: number;
  groupId: number;
  runId: number;
  /** ライブラリの根からの相対パス(`/` 区切り) */
  relPath: string;
  bucket: Bucket;
  isRepaired: boolean;
  /** `thumbs/` からの相対パス */
  thumbRelPath: string | null;
  createdAt: string;
  albumEventId: number | null;
};

export type LibraryFileInput = {
  contentId: number;
  groupId: number;
  runId: number;
  relPath: string;
  bucket: Bucket;
  isRepaired?: boolean;
  thumbRelPath?: string;
  createdAt: Date;
};

type LibraryFileRow = Omit<LibraryFileRecord, 'isRepaired'> & {
  isRepaired: number;
};

const COLUMNS = `library_file_id AS libraryFileId, content_id AS contentId, group_id AS groupId,
  run_id AS runId, rel_path AS relPath, bucket, is_repaired AS isRepaired,
  thumb_rel_path AS thumbRelPath, created_at AS createdAt, album_event_id AS albumEventId`;

const toRecord = (row: LibraryFileRow): LibraryFileRecord => ({
  ...row,
  isRepaired: row.isRepaired === 1,
});

/** ライブラリに保存したファイルを記録する。ID を返す。大文字小文字だけが違うパスも、重複として断る */
export const insertLibraryFile = (
  db: Database,
  input: LibraryFileInput
): number => {
  const result = db
    .query(
      `INSERT INTO library_files
         (content_id, group_id, run_id, rel_path, bucket, is_repaired, thumb_rel_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.contentId,
      input.groupId,
      input.runId,
      input.relPath,
      input.bucket,
      input.isRepaired ? 1 : 0,
      input.thumbRelPath ?? null,
      formatTimestamp(input.createdAt)
    );
  return Number(result.lastInsertRowid);
};

export const getLibraryFile = (
  db: Database,
  libraryFileId: number
): LibraryFileRecord | undefined => {
  const row = db
    .query<LibraryFileRow, [number]>(
      `SELECT ${COLUMNS} FROM library_files WHERE library_file_id = ?`
    )
    .get(libraryFileId);
  return row ? toRecord(row) : undefined;
};

/**
 * 名前の衝突の確認に使う(`core` の `choosePlacements` の `isTaken`)。
 * 大文字小文字を区別せずに比べる(exFAT などに合わせる)。区別しないのは ASCII の文字だけなので、
 * それ以外の文字は、呼び出し側が、出力先の実在も確かめる。
 */
export const libraryPathExists = (db: Database, relPath: string): boolean =>
  db
    .query<{ found: number }, [string]>(
      'SELECT 1 AS found FROM library_files WHERE rel_path = ? COLLATE NOCASE LIMIT 1'
    )
    .get(relPath) !== null;

/** 同じ内容(`content_id`)の、ライブラリのファイルすべて(原本の探索に使う。`er.md` §3-6) */
export const listLibraryFilesByContent = (
  db: Database,
  contentId: number
): LibraryFileRecord[] =>
  db
    .query<LibraryFileRow, [number]>(
      `SELECT ${COLUMNS} FROM library_files WHERE content_id = ? ORDER BY library_file_id`
    )
    .all(contentId)
    .map(toRecord);

/** 同名グループのファイルすべて(RAW+JPEG など) */
export const listLibraryFilesByGroup = (
  db: Database,
  groupId: number
): LibraryFileRecord[] =>
  db
    .query<LibraryFileRow, [number]>(
      `SELECT ${COLUMNS} FROM library_files WHERE group_id = ? ORDER BY library_file_id`
    )
    .all(groupId)
    .map(toRecord);
