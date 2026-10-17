import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './time.ts';

export type DuplicateLink = {
  linkId: number;
  skippedSourceFileId: number;
  adoptedLibraryFileId: number;
  createdAt: string;
};

const COLUMNS = `link_id AS linkId, skipped_source_file_id AS skippedSourceFileId,
  adopted_library_file_id AS adoptedLibraryFileId, created_at AS createdAt`;

/** 重複の「スキップ側」と「採用側」の対応を記録する。スキップ側は、1 つの採用側だけを指せる */
export const insertDuplicateLink = (
  db: Database,
  input: {
    skippedSourceFileId: number;
    adoptedLibraryFileId: number;
    createdAt: Date;
  }
): number => {
  const result = db
    .query(
      `INSERT INTO duplicate_links (skipped_source_file_id, adopted_library_file_id, created_at)
       VALUES (?, ?, ?)`
    )
    .run(
      input.skippedSourceFileId,
      input.adoptedLibraryFileId,
      formatTimestamp(input.createdAt)
    );
  return Number(result.lastInsertRowid);
};

export const findDuplicateLinkBySource = (
  db: Database,
  skippedSourceFileId: number
): DuplicateLink | undefined =>
  db
    .query<DuplicateLink, [number]>(
      `SELECT ${COLUMNS} FROM duplicate_links WHERE skipped_source_file_id = ?`
    )
    .get(skippedSourceFileId) ?? undefined;

/** 採用側のファイルに、スキップされたものすべて */
export const listDuplicateLinksByAdopted = (
  db: Database,
  adoptedLibraryFileId: number
): DuplicateLink[] =>
  db
    .query<DuplicateLink, [number]>(
      `SELECT ${COLUMNS} FROM duplicate_links WHERE adopted_library_file_id = ? ORDER BY link_id`
    )
    .all(adoptedLibraryFileId);
