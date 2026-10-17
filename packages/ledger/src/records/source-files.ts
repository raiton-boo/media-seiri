import type { Database } from 'bun:sqlite';
import { type FileKind, toMtimeMs } from '@file-seiri/core';

export type SourceFileState =
  | 'scanned'
  | 'analyzed'
  | 'planned'
  | 'duplicate'
  | 'done'
  | 'error'
  | 'ignored';

/** 台帳に持つ種類。`core` の `xmp` は、台帳では `sidecar` と呼ぶ */
export type SourceFileKind = 'photo' | 'raw' | 'video' | 'sidecar';

/**
 * `core` の `FileKind` を、台帳の種類にする。台帳に行を作らないもの(Takeout の `json`・対象外の `unsupported`)は、
 * undefined(件数だけを数え、`source_files` には記録しない)。
 */
export const toSourceFileKind = (
  kind: FileKind
): SourceFileKind | undefined => {
  switch (kind) {
    case 'photo':
    case 'raw':
    case 'video':
      return kind;
    case 'xmp':
      return 'sidecar';
    case 'json':
    case 'unsupported':
      return undefined;
  }
};

export type SourceFileRecord = {
  sourceFileId: number;
  runId: number;
  volumeId: number;
  containerId: number | null;
  zipDepth: number;
  relPath: string;
  entryPath: string | null;
  sizeBytes: number;
  mtimeMs: number;
  kind: SourceFileKind;
  ext: string;
  contentId: number | null;
  state: SourceFileState;
  ignoreReason: string | null;
};

export type SourceFileInput = {
  runId: number;
  volumeId: number;
  /** ZIP の中身なら、親の ZIP の ID。`entryPath` と一緒に指定する */
  containerId?: number;
  zipDepth?: number;
  relPath: string;
  entryPath?: string;
  sizeBytes: number;
  /** 小数のミリ秒でもよい。切り捨てて保存する */
  mtimeMs: number;
  kind: SourceFileKind;
  ext: string;
};

const COLUMNS = `source_file_id AS sourceFileId, run_id AS runId, volume_id AS volumeId,
  container_id AS containerId, zip_depth AS zipDepth, rel_path AS relPath, entry_path AS entryPath,
  size_bytes AS sizeBytes, mtime_ms AS mtimeMs, kind, ext, content_id AS contentId, state,
  ignore_reason AS ignoreReason`;

/** ソース側のファイルを記録する(状態は `scanned`)。ID を返す。同じ実行の同じファイルは、2 度記録できない */
export const insertSourceFile = (
  db: Database,
  input: SourceFileInput
): number => {
  const result = db
    .query(
      `INSERT INTO source_files
         (run_id, volume_id, container_id, zip_depth, rel_path, entry_path, size_bytes, mtime_ms, kind, ext)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      input.volumeId,
      input.containerId ?? null,
      input.zipDepth ?? 0,
      input.relPath,
      input.entryPath ?? null,
      input.sizeBytes,
      toMtimeMs(input.mtimeMs),
      input.kind,
      input.ext
    );
  return Number(result.lastInsertRowid);
};

export const getSourceFile = (
  db: Database,
  sourceFileId: number
): SourceFileRecord | undefined =>
  db
    .query<SourceFileRecord, [number]>(
      `SELECT ${COLUMNS} FROM source_files WHERE source_file_id = ?`
    )
    .get(sourceFileId) ?? undefined;

/** 状態を変える。`ignored` のときは、対象外の理由を、一緒に記録する */
export const setSourceFileState = (
  db: Database,
  sourceFileId: number,
  state: SourceFileState,
  ignoreReason?: string
): void => {
  const result = db
    .query(
      'UPDATE source_files SET state = ?, ignore_reason = ? WHERE source_file_id = ?'
    )
    .run(state, ignoreReason ?? null, sourceFileId);
  if (result.changes === 0) {
    throw new Error(`ソースのファイルがありません: ${sourceFileId}`);
  }
};

/** ハッシュを決めた内容を、ソースのファイルに結びつける */
export const setSourceFileContent = (
  db: Database,
  sourceFileId: number,
  contentId: number
): void => {
  const result = db
    .query('UPDATE source_files SET content_id = ? WHERE source_file_id = ?')
    .run(contentId, sourceFileId);
  if (result.changes === 0) {
    throw new Error(`ソースのファイルがありません: ${sourceFileId}`);
  }
};

/** 実行ごとの、状態別の一覧(古い順) */
export const listSourceFiles = (
  db: Database,
  runId: number,
  state: SourceFileState
): SourceFileRecord[] =>
  db
    .query<SourceFileRecord, [number, string]>(
      `SELECT ${COLUMNS} FROM source_files
       WHERE run_id = ? AND state = ? ORDER BY source_file_id`
    )
    .all(runId, state);

/** 実行ごとの、状態別の件数。0 件の状態は、含まない */
export const countSourceFilesByState = (
  db: Database,
  runId: number
): Partial<Record<SourceFileState, number>> => {
  const rows = db
    .query<{ state: SourceFileState; count: number }, [number]>(
      'SELECT state, count(*) AS count FROM source_files WHERE run_id = ? GROUP BY state'
    )
    .all(runId);
  return Object.fromEntries(rows.map((row) => [row.state, row.count]));
};

/** 同じ内容(`content_id`)の、ソース側のファイルすべて(原本の探索に使う。`er.md` §3-6) */
export const listSourceFilesByContent = (
  db: Database,
  contentId: number
): SourceFileRecord[] =>
  db
    .query<SourceFileRecord, [number]>(
      `SELECT ${COLUMNS} FROM source_files WHERE content_id = ? ORDER BY source_file_id`
    )
    .all(contentId);

/**
 * 再実行で、処理済みか(仕様書 §8-3)。ボリューム・相対パス・サイズ・更新日が同じで、
 * 本番の実行(dry-run でない)で、`done` か `duplicate` になったものを探す。ZIP の中身は、対象にしない。
 */
export const findProcessedSourceFile = (
  db: Database,
  key: { volumeId: number; relPath: string; sizeBytes: number; mtimeMs: number }
): SourceFileRecord | undefined => {
  const found = db
    .query<{ id: number }, [number, string, number, number]>(
      `SELECT s.source_file_id AS id
       FROM source_files AS s JOIN runs AS r ON r.run_id = s.run_id
       WHERE s.volume_id = ? AND s.rel_path = ? AND s.size_bytes = ? AND s.mtime_ms = ?
         AND s.container_id IS NULL AND s.state IN ('done', 'duplicate') AND r.is_dry_run = 0
       ORDER BY s.source_file_id DESC LIMIT 1`
    )
    .get(key.volumeId, key.relPath, key.sizeBytes, toMtimeMs(key.mtimeMs));
  return found ? getSourceFile(db, found.id) : undefined;
};
