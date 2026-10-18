import type { Database } from 'bun:sqlite';

/** 日付を、本体のメタデータではなく、ほかから決めたもの(フォールバック)の、取得元 */
export type FallbackSource = 'json' | 'filename' | 'none';
export const FALLBACK_SOURCES: readonly FallbackSource[] = [
  'json',
  'filename',
  'none',
];
export const DATE_PRECISIONS = [
  'full',
  'date',
  'month',
  'year',
  'none',
  'invalid',
] as const;
export type DatePrecisionFilter = (typeof DATE_PRECISIONS)[number];

export type FallbackFilter = {
  dateSource?: FallbackSource;
  precision?: DatePrecisionFilter;
  /** ソースのドライブ */
  volumeId?: number;
  /** ライブラリに保存した実行 */
  runId?: number;
};

export type FallbackRow = {
  libraryFileId: number;
  /** 保存した場所(ライブラリの根からの相対パス) */
  libraryRelPath: string;
  /** 元の場所(ソース側)。見つからなければ null */
  source: {
    volumeLabel: string | null;
    relPath: string;
    entryPath: string | null;
  } | null;
  /** 決めた日付(精度までの文字列)。日付なし・不正は null */
  takenAt: string | null;
  datePrecision: string;
  dateSource: string;
  dateReason: string;
  /** 参考の更新日(ミリ秒)。採用しない、参考情報 */
  mtimeRefMs: number | null;
};

type Row = {
  libraryFileId: number;
  libraryRelPath: string;
  sourceRelPath: string | null;
  entryPath: string | null;
  volumeLabel: string | null;
  takenAt: string | null;
  datePrecision: string;
  dateSource: string;
  dateReason: string;
  mtimeRefMs: number | null;
};

// 元の場所は、同じ内容の、コピーした(`done`)ソースのファイルのうち、いちばん早いもの
const FROM = `FROM library_files AS f
  JOIN media_metadata AS m ON m.content_id = f.content_id
  LEFT JOIN source_files AS s ON s.source_file_id = (
    SELECT min(x.source_file_id) FROM source_files AS x
    WHERE x.content_id = f.content_id AND x.state = 'done')
  LEFT JOIN volumes AS v ON v.volume_id = s.volume_id`;

const whereOf = (
  filter: FallbackFilter
): { sql: string; params: (string | number)[] } => {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.dateSource) {
    conditions.push('m.date_source = ?');
    params.push(filter.dateSource);
  } else {
    conditions.push("m.date_source IN ('json', 'filename', 'none')");
  }
  if (filter.precision) {
    conditions.push('m.date_precision = ?');
    params.push(filter.precision);
  }
  if (filter.volumeId !== undefined) {
    conditions.push('s.volume_id = ?');
    params.push(filter.volumeId);
  }
  if (filter.runId !== undefined) {
    conditions.push('f.run_id = ?');
    params.push(filter.runId);
  }
  return { sql: `WHERE ${conditions.join(' AND ')}`, params };
};

/** 日付フォールバックの一覧(新しく保存したものから)。`total` は、ページに関係なく、絞り込みに合う全件数 */
export const browseDateFallbacks = (
  db: Database,
  filter: FallbackFilter,
  page: { limit: number; offset: number }
): { total: number; items: FallbackRow[] } => {
  const { sql, params } = whereOf(filter);
  const total =
    db
      .query<{ n: number }, (string | number)[]>(
        `SELECT count(*) AS n ${FROM} ${sql}`
      )
      .get(...params)?.n ?? 0;
  const rows = db
    .query<Row, (string | number)[]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS libraryRelPath,
              s.rel_path AS sourceRelPath, s.entry_path AS entryPath, v.label AS volumeLabel,
              m.taken_at AS takenAt, m.date_precision AS datePrecision, m.date_source AS dateSource,
              m.date_reason AS dateReason, m.mtime_ref_ms AS mtimeRefMs
       ${FROM} ${sql}
       ORDER BY f.library_file_id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit, page.offset);
  return {
    total,
    items: rows.map((row) => ({
      libraryFileId: row.libraryFileId,
      libraryRelPath: row.libraryRelPath,
      source:
        row.sourceRelPath === null
          ? null
          : {
              volumeLabel: row.volumeLabel,
              relPath: row.sourceRelPath,
              entryPath: row.entryPath,
            },
      takenAt: row.takenAt,
      datePrecision: row.datePrecision,
      dateSource: row.dateSource,
      dateReason: row.dateReason,
      mtimeRefMs: row.mtimeRefMs,
    })),
  };
};

/** 取得元ごとの件数(絞り込みは、反映しない。カードに、全体を出すため) */
export const countDateFallbacks = (
  db: Database
): Record<FallbackSource, number> => {
  const counts: Record<FallbackSource, number> = {
    json: 0,
    filename: 0,
    none: 0,
  };
  const rows = db
    .query<{ source: FallbackSource; n: number }, []>(
      `SELECT m.date_source AS source, count(*) AS n
       FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE m.date_source IN ('json', 'filename', 'none') GROUP BY m.date_source`
    )
    .all();
  for (const row of rows) counts[row.source] = row.n;
  return counts;
};

/** ソースのドライブの選択肢(ファイルを取り込んだことのあるもの) */
export const listSourceVolumes = (
  db: Database
): { volumeId: number; label: string | null }[] =>
  db
    .query<{ volumeId: number; label: string | null }, []>(
      `SELECT v.volume_id AS volumeId, v.label FROM volumes AS v
       WHERE v.volume_id IN (SELECT DISTINCT volume_id FROM source_files)
       ORDER BY v.volume_id`
    )
    .all();
