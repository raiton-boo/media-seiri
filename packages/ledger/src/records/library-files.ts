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

/** できごとに属する写真。撮影日時の順(同じなら、登録の順) */
export const listLibraryFilesByAlbumEvent = (
  db: Database,
  albumEventId: number
): LibraryFileRecord[] =>
  db
    .query<LibraryFileRow, [number]>(
      `SELECT ${COLUMNS} FROM library_files WHERE album_event_id = ?
       ORDER BY (SELECT taken_at FROM media_metadata AS m WHERE m.content_id = library_files.content_id),
         library_file_id`
    )
    .all(albumEventId)
    .map(toRecord);

/** サムネイルを作る(確かめる)ための、ライブラリのファイル */
export type ThumbnailCandidate = {
  libraryFileId: number;
  relPath: string;
  thumbRelPath: string | null;
  /** 内容のハッシュ(SHA-256 の 16 進)。サムネイルの名前に使う */
  contentHash: string;
};

/** ライブラリのファイルすべて(登録の順)と、サムネイルの記録。実在の確認は、呼び出し側が行う */
export const listThumbnailCandidates = (db: Database): ThumbnailCandidate[] =>
  db
    .query<ThumbnailCandidate, []>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath,
              f.thumb_rel_path AS thumbRelPath, c.hash AS contentHash
       FROM library_files AS f JOIN contents AS c ON c.content_id = f.content_id
       ORDER BY f.library_file_id`
    )
    .all();

/** サムネイルの場所(`thumbs/` からの相対パス)を記録する */
export const setThumbRelPath = (
  db: Database,
  libraryFileId: number,
  thumbRelPath: string
): void => {
  const result = db
    .query(
      'UPDATE library_files SET thumb_rel_path = ? WHERE library_file_id = ?'
    )
    .run(thumbRelPath, libraryFileId);
  if (result.changes === 0)
    throw new Error(`ライブラリのファイルがありません: ${libraryFileId}`);
};
