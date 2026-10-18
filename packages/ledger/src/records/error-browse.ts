import type { Database } from 'bun:sqlite';
import type { SourceFileKind } from './source-files.ts';

/** エラー一覧の絞り込み */
export type ErrorFilter = {
  /** コード。末尾が `*` なら、前方一致(`ZIP_*`) */
  code?: string;
  /**
   * 実行。指定がなければ、通常の実行(dry-run でない)のエラーだけ。
   * 指定すれば、その実行のエラー(dry-run の実行でも)。
   */
  runId?: number;
};

export type BrowsedError = {
  errorId: number;
  runId: number;
  code: string;
  detail: string;
  occurredAt: string;
  /** エラーになったファイル(ソース側)。ファイルに結びつかないエラーは null */
  source: {
    sourceFileId: number;
    /** ソースのドライブの名前 */
    volumeLabel: string | null;
    relPath: string;
    /** ZIP の中のパス(ZIP の中身のとき) */
    entryPath: string | null;
    kind: SourceFileKind;
    /** 同じ内容が、ライブラリにあり、サムネイルがあれば、その場所(`thumbs/` からの相対パス) */
    thumbRelPath: string | null;
  } | null;
};

type Row = {
  errorId: number;
  runId: number;
  code: string;
  detail: string;
  occurredAt: string;
  sourceFileId: number | null;
  volumeLabel: string | null;
  relPath: string | null;
  entryPath: string | null;
  kind: SourceFileKind | null;
  thumbRelPath: string | null;
};

const likePattern = (prefix: string): string =>
  `${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const whereOf = (
  filter: ErrorFilter
): { sql: string; params: (string | number)[] } => {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.runId === undefined) {
    conditions.push('r.is_dry_run = 0');
  } else {
    conditions.push('e.run_id = ?');
    params.push(filter.runId);
  }
  if (filter.code !== undefined) {
    if (filter.code.endsWith('*')) {
      conditions.push("e.code LIKE ? ESCAPE '\\'");
      params.push(likePattern(filter.code.slice(0, -1)));
    } else {
      conditions.push('e.code = ?');
      params.push(filter.code);
    }
  }
  return { sql: `WHERE ${conditions.join(' AND ')}`, params };
};

const FROM = `FROM errors AS e
  JOIN runs AS r ON r.run_id = e.run_id
  LEFT JOIN source_files AS s ON s.source_file_id = e.source_file_id
  LEFT JOIN volumes AS v ON v.volume_id = s.volume_id`;

/**
 * エラーの一覧(新しい順)。`limit` が null なら、すべて(CSV の書き出し用)。
 * `total` は、ページに関係なく、絞り込みに合う全件数。
 */
export const browseErrors = (
  db: Database,
  filter: ErrorFilter,
  page: { limit: number | null; offset: number }
): { total: number; items: BrowsedError[] } => {
  const { sql, params } = whereOf(filter);
  const total =
    db
      .query<{ n: number }, (string | number)[]>(
        `SELECT count(*) AS n ${FROM} ${sql}`
      )
      .get(...params)?.n ?? 0;
  const rows = db
    .query<Row, (string | number)[]>(
      `SELECT e.error_id AS errorId, e.run_id AS runId, e.code, e.detail, e.occurred_at AS occurredAt,
              s.source_file_id AS sourceFileId, v.label AS volumeLabel, s.rel_path AS relPath,
              s.entry_path AS entryPath, s.kind,
              (SELECT f.thumb_rel_path FROM library_files AS f
                 WHERE f.content_id = s.content_id AND f.thumb_rel_path IS NOT NULL LIMIT 1) AS thumbRelPath
       ${FROM} ${sql}
       ORDER BY e.occurred_at DESC, e.error_id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit ?? -1, page.offset);
  return {
    total,
    items: rows.map((row) => ({
      errorId: row.errorId,
      runId: row.runId,
      code: row.code,
      detail: row.detail,
      occurredAt: row.occurredAt,
      source:
        row.sourceFileId === null || row.relPath === null || row.kind === null
          ? null
          : {
              sourceFileId: row.sourceFileId,
              volumeLabel: row.volumeLabel,
              relPath: row.relPath,
              entryPath: row.entryPath,
              kind: row.kind,
              thumbRelPath: row.thumbRelPath,
            },
    })),
  };
};

/** コード別の件数(多い順)。`runId` の扱いは、`ErrorFilter` と同じ */
export const countErrorCodes = (
  db: Database,
  filter: Pick<ErrorFilter, 'runId'>
): { code: string; count: number }[] => {
  const { sql, params } = whereOf({ runId: filter.runId });
  return db
    .query<{ code: string; count: number }, (string | number)[]>(
      `SELECT e.code, count(*) AS count ${FROM} ${sql}
       GROUP BY e.code ORDER BY count DESC, e.code`
    )
    .all(...params);
};

export const getBrowsedError = (
  db: Database,
  errorId: number
): BrowsedError | undefined => {
  const found = db
    .query<{ runId: number }, [number]>(
      'SELECT run_id AS runId FROM errors WHERE error_id = ?'
    )
    .get(errorId);
  if (!found) return undefined;
  // 実行を指定して、dry-run のエラーも探せるようにする
  return browseErrors(
    db,
    { runId: found.runId },
    { limit: null, offset: 0 }
  ).items.find((item) => item.errorId === errorId);
};
