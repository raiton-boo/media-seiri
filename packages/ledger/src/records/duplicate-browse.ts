import type { Database } from 'bun:sqlite';
import { likeContains } from './like.ts';

/** 重複比較の絞り込み */
export type DuplicateFilter = {
  /** スキップしたファイルの、ソースのドライブ */
  volumeId?: number;
  /**
   * 実行。指定がなければ、通常の実行(dry-run でない)のスキップだけ。
   * 指定すれば、その実行のスキップ(dry-run の実行でも)。
   */
  runId?: number;
  /** ファイル名(採用側・スキップ側のパスの一部) */
  query?: string;
};

/** 重複のグループ: 採用したファイル 1 つと、スキップしたファイルの数 */
export type DuplicateGroup = {
  adoptedLibraryFileId: number;
  adoptedRelPath: string;
  contentHash: string;
  sizeBytes: number;
  skippedCount: number;
  thumbRelPath: string | null;
};

const whereOf = (
  filter: DuplicateFilter
): { sql: string; params: (string | number)[] } => {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.runId === undefined) {
    conditions.push('r.is_dry_run = 0');
  } else {
    conditions.push('s.run_id = ?');
    params.push(filter.runId);
  }
  if (filter.volumeId !== undefined) {
    conditions.push('s.volume_id = ?');
    params.push(filter.volumeId);
  }
  if (filter.query) {
    conditions.push(
      "(f.rel_path LIKE ? ESCAPE '\\' OR s.rel_path LIKE ? ESCAPE '\\')"
    );
    const pattern = likeContains(filter.query);
    params.push(pattern, pattern);
  }
  return { sql: `WHERE ${conditions.join(' AND ')}`, params };
};

const FROM = `FROM duplicate_links AS d
  JOIN source_files AS s ON s.source_file_id = d.skipped_source_file_id
  JOIN runs AS r ON r.run_id = s.run_id
  JOIN library_files AS f ON f.library_file_id = d.adopted_library_file_id
  JOIN contents AS c ON c.content_id = f.content_id`;

/**
 * 重複のグループの一覧(新しくスキップしたものから)。`total` は、絞り込みに合うグループの数、
 * `totalSkipped` は、スキップしたファイルの数。
 */
export const browseDuplicateGroups = (
  db: Database,
  filter: DuplicateFilter,
  page: { limit: number; offset: number }
): { total: number; totalSkipped: number; items: DuplicateGroup[] } => {
  const { sql, params } = whereOf(filter);
  const totals = db
    .query<{ groups: number; skipped: number }, (string | number)[]>(
      `SELECT count(DISTINCT d.adopted_library_file_id) AS groups, count(*) AS skipped ${FROM} ${sql}`
    )
    .get(...params);
  const items = db
    .query<DuplicateGroup, (string | number)[]>(
      `SELECT d.adopted_library_file_id AS adoptedLibraryFileId, f.rel_path AS adoptedRelPath,
              c.hash AS contentHash, c.size_bytes AS sizeBytes, count(*) AS skippedCount,
              f.thumb_rel_path AS thumbRelPath
       ${FROM} ${sql}
       GROUP BY d.adopted_library_file_id
       ORDER BY max(d.link_id) DESC LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit, page.offset);
  return {
    total: totals?.groups ?? 0,
    totalSkipped: totals?.skipped ?? 0,
    items,
  };
};

/** 採用側と、スキップ側すべての、比較用の詳細 */
export type DuplicateGroupDetail = {
  adopted: {
    libraryFileId: number;
    relPath: string;
    contentHash: string;
    sizeBytes: number;
    thumbRelPath: string | null;
    /** 取り込んだ実行 */
    runId: number;
    takenAt: string | null;
    datePrecision: string | null;
    dateSource: string | null;
    cameraMake: string | null;
    cameraModel: string | null;
  };
  skipped: {
    sourceFileId: number;
    volumeLabel: string | null;
    relPath: string;
    entryPath: string | null;
    runId: number;
    sizeBytes: number;
    mtimeMs: number;
    isDryRun: boolean;
  }[];
};

export const getDuplicateGroup = (
  db: Database,
  adoptedLibraryFileId: number
): DuplicateGroupDetail | undefined => {
  const adopted = db
    .query<DuplicateGroupDetail['adopted'], [number]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, c.hash AS contentHash,
              c.size_bytes AS sizeBytes, f.thumb_rel_path AS thumbRelPath, f.run_id AS runId,
              m.taken_at AS takenAt, m.date_precision AS datePrecision, m.date_source AS dateSource,
              m.camera_make AS cameraMake, m.camera_model AS cameraModel
       FROM library_files AS f
       JOIN contents AS c ON c.content_id = f.content_id
       LEFT JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE f.library_file_id = ?`
    )
    .get(adoptedLibraryFileId);
  if (!adopted) return undefined;
  const skipped = db
    .query<
      Omit<DuplicateGroupDetail['skipped'][number], 'isDryRun'> & {
        isDryRun: number;
      },
      [number]
    >(
      `SELECT s.source_file_id AS sourceFileId, v.label AS volumeLabel, s.rel_path AS relPath,
              s.entry_path AS entryPath, s.run_id AS runId, s.size_bytes AS sizeBytes,
              s.mtime_ms AS mtimeMs, r.is_dry_run AS isDryRun
       FROM duplicate_links AS d
       JOIN source_files AS s ON s.source_file_id = d.skipped_source_file_id
       JOIN runs AS r ON r.run_id = s.run_id
       LEFT JOIN volumes AS v ON v.volume_id = s.volume_id
       WHERE d.adopted_library_file_id = ?
       ORDER BY d.link_id DESC`
    )
    .all(adoptedLibraryFileId)
    .map((row) => ({ ...row, isDryRun: row.isDryRun === 1 }));
  return { adopted, skipped };
};
