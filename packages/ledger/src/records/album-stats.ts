import type { Database } from 'bun:sqlite';
import { EXTENSIONS_BY_KIND } from '@file-seiri/core';
import {
  type AlbumFilter,
  albumFilterSql,
  UNKNOWN_CAMERA,
} from './album-filter.ts';

const FILES = `FROM library_files AS f
  JOIN media_metadata AS m ON m.content_id = f.content_id
  JOIN contents AS c ON c.content_id = f.content_id`;

type Param = string | number;

/** 種別ごとの件数 */
export type KindCounts = { photo: number; video: number; raw: number };

const emptyKinds = (): KindCounts => ({ photo: 0, video: 0, raw: 0 });

/**
 * 拡張子から種別を決める SQL(`f.rel_path` の末尾)。拡張子は、決まった定数(英数字だけ)なので、そのまま文に入れる。
 * 動画・RAW 以外は、写真。
 */
const likesOf = (kind: 'video' | 'raw'): string =>
  EXTENSIONS_BY_KIND[kind]
    .map((extension) => `lower(f.rel_path) LIKE '%.${extension}'`)
    .join(' OR ');
const KIND_SQL = `CASE WHEN (${likesOf('video')}) THEN 'video' WHEN (${likesOf('raw')}) THEN 'raw' ELSE 'photo' END`;

/** 期間 1 つぶんの件数(種別の内訳つき) */
export type PeriodBucket = KindCounts & { count: number };

export type StatsPeriods = {
  /** 年ごと(新しい年が先ではなく、古い年から) */
  years: ({ year: number } & PeriodBucket)[];
  /** 年が取れていないもの(日付なし・不正) */
  yearUnknown: PeriodBucket;
  /** 選んだ年の 12 か月(1〜12 月。枚数 0 の月も含む)。年が選べなければ、空 */
  months: ({ month: number } & PeriodBucket)[];
  /** 選んだ年のうち、月が取れていないもの(年だけのもの) */
  monthUnknown: PeriodBucket;
  /** 月別に出している年(写真が 1 枚もなければ null) */
  monthsYear: number | null;
};

/** 統計(通常の実行で取り込んだデータ。絞り込みの条件が、すべてに効く) */
export type LibraryStats = {
  total: number;
  sizeBytes: number;
  /** 日付が取れた範囲(精度は、それぞれの精度まで)。なければ null */
  period: { from: string; to: string } | null;
  /** 種別の件数(種別の絞り込みは、効かない。選べる種類の件数を見せるため) */
  kinds: KindCounts;
  periods: StatsPeriods;
  /** カメラ別(多い順。機種が不明なものは「不明」。上位だけ) */
  cameras: { name: string; count: number }[];
  /** 撮影時間帯(0〜23 時の件数。精度が `full` のものだけ) */
  hours: number[];
  /** 時間帯の対象外の件数(時刻が取れていない = 精度が `full` 未満) */
  hoursExcluded: number;
  /** 日付の精度ごとの件数 */
  precisions: Record<string, number>;
  /** 日付の取得元ごとの件数 */
  sources: Record<string, number>;
  gps: { with: number; without: number };
};

/** カメラ別に出す、機種の数(それより多いと、読みにくい) */
const CAMERA_LIMIT = 8;

const bucketOf = (rows: { kind: string; n: number }[]): PeriodBucket => {
  const bucket: PeriodBucket = { count: 0, ...emptyKinds() };
  for (const row of rows) {
    if (row.kind === 'photo' || row.kind === 'video' || row.kind === 'raw')
      bucket[row.kind] += row.n;
    bucket.count += row.n;
  }
  return bucket;
};

/**
 * 統計をまとめる。`filter` が、すべての集計に効く(種別の件数だけは、種別の条件を外して数える)。
 * `year` が、月別に出す年(省くと、写真のある、いちばん新しい年)。
 */
export const getLibraryStats = (
  db: Database,
  filter: AlbumFilter,
  year?: number
): LibraryStats => {
  const { sql, params } = albumFilterSql(filter);
  const all = <T>(query: string, extra: Param[] = []): T[] =>
    db.query<T, Param[]>(query).all(...extra, ...params);
  const one = <T>(query: string, extra: Param[] = []): T | null =>
    db.query<T, Param[]>(query).get(...extra, ...params);

  const totals = one<{
    n: number;
    size: number | null;
    from: string | null;
    to: string | null;
  }>(
    `SELECT count(*) AS n, sum(c.size_bytes) AS size, min(m.taken_at) AS "from", max(m.taken_at) AS "to"
     ${FILES} WHERE 1 = 1${sql}`
  );

  // 種別の件数: 種別の条件を外す
  const withoutKinds = { ...filter };
  delete withoutKinds.kinds;
  const kindWhere = albumFilterSql(withoutKinds);
  const kinds = emptyKinds();
  for (const row of db
    .query<{ kind: string; n: number }, Param[]>(
      `SELECT ${KIND_SQL} AS kind, count(*) AS n ${FILES} WHERE 1 = 1${kindWhere.sql} GROUP BY kind`
    )
    .all(...kindWhere.params)) {
    if (row.kind === 'photo' || row.kind === 'video' || row.kind === 'raw')
      kinds[row.kind] = row.n;
  }

  // 期間別: 年
  const yearRows = all<{ year: number | null; kind: string; n: number }>(
    `SELECT CASE WHEN m.taken_at IS NULL THEN NULL ELSE CAST(substr(m.taken_at, 1, 4) AS INTEGER) END AS year,
            ${KIND_SQL} AS kind, count(*) AS n
     ${FILES} WHERE 1 = 1${sql} GROUP BY year, kind`
  );
  const byYear = new Map<number, { kind: string; n: number }[]>();
  const unknownYear: { kind: string; n: number }[] = [];
  for (const row of yearRows) {
    if (row.year === null) unknownYear.push(row);
    else byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
  }
  const years = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, rows]) => ({ year: y, ...bucketOf(rows) }));

  // 期間別: 選んだ年の月
  const monthsYear = year ?? years[years.length - 1]?.year ?? null;
  const monthRows =
    monthsYear === null
      ? []
      : all<{ month: number | null; kind: string; n: number }>(
          `SELECT CASE WHEN length(m.taken_at) >= 7 THEN CAST(substr(m.taken_at, 6, 2) AS INTEGER) END AS month,
                  ${KIND_SQL} AS kind, count(*) AS n
           ${FILES} WHERE m.taken_at LIKE ? || '%'${sql} GROUP BY month, kind`,
          [String(monthsYear).padStart(4, '0')]
        );
  const byMonth = new Map<number, { kind: string; n: number }[]>();
  const unknownMonth: { kind: string; n: number }[] = [];
  for (const row of monthRows) {
    if (row.month === null) unknownMonth.push(row);
    else byMonth.set(row.month, [...(byMonth.get(row.month) ?? []), row]);
  }
  const months =
    monthsYear === null
      ? []
      : Array.from({ length: 12 }, (_, index) => ({
          month: index + 1,
          ...bucketOf(byMonth.get(index + 1) ?? []),
        }));

  const cameras = all<{ name: string; count: number }>(
    `SELECT coalesce(m.camera_model, '${UNKNOWN_CAMERA}') AS name, count(*) AS count
     ${FILES} WHERE 1 = 1${sql}
     GROUP BY name ORDER BY (name = '${UNKNOWN_CAMERA}'), count DESC, name LIMIT ${CAMERA_LIMIT}`
  );

  const hours = Array.from({ length: 24 }, () => 0);
  for (const row of all<{ hour: number; n: number }>(
    `SELECT CAST(substr(m.taken_at, 12, 2) AS INTEGER) AS hour, count(*) AS n
     ${FILES} WHERE length(m.taken_at) >= 19${sql} GROUP BY hour`
  )) {
    if (row.hour >= 0 && row.hour < 24) hours[row.hour] = row.n;
  }
  const timed = hours.reduce((sum, n) => sum + n, 0);

  const countBy = (
    column: 'date_precision' | 'date_source'
  ): Record<string, number> =>
    Object.fromEntries(
      all<{ key: string; n: number }>(
        `SELECT m.${column} AS key, count(*) AS n ${FILES} WHERE 1 = 1${sql} GROUP BY key`
      ).map((row) => [row.key, row.n])
    );

  const gps = one<{ withGps: number | null; withoutGps: number | null }>(
    `SELECT sum(m.gps_lat IS NOT NULL AND NOT (m.gps_lat = 0 AND m.gps_lon = 0)) AS withGps,
            sum(m.gps_lat IS NULL OR (m.gps_lat = 0 AND m.gps_lon = 0)) AS withoutGps
     ${FILES} WHERE 1 = 1${sql}`
  );

  const total = totals?.n ?? 0;
  return {
    total,
    sizeBytes: totals?.size ?? 0,
    period:
      totals?.from && totals.to ? { from: totals.from, to: totals.to } : null,
    kinds,
    periods: {
      years,
      yearUnknown: bucketOf(unknownYear),
      months,
      monthUnknown: bucketOf(unknownMonth),
      monthsYear,
    },
    cameras,
    hours,
    hoursExcluded: total - timed,
    precisions: countBy('date_precision'),
    sources: countBy('date_source'),
    gps: { with: gps?.withGps ?? 0, without: gps?.withoutGps ?? 0 },
  };
};
