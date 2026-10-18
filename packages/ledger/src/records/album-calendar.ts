import type { Database } from 'bun:sqlite';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

type Param = string | number;

/** 日まで分かる写真だけを、数える(撮影日時が、`YYYY-MM-DD` 以上の長さ。年・月だけのものは、載らない) */
const HAS_DAY = 'length(m.taken_at) >= 10';

/** カレンダーの 1 日 */
export type CalendarDay = { date: string; count: number };

/** 1 年の、日ごとの枚数(写真のある日だけ。日付の順) */
export const listCalendarDays = (
  db: Database,
  year: number,
  filter: AlbumFilter
): CalendarDay[] => {
  const { sql, params } = albumFilterSql(filter);
  return db
    .query<CalendarDay, Param[]>(
      `SELECT substr(m.taken_at, 1, 10) AS date, count(*) AS count ${FILES}
       WHERE m.taken_at LIKE ? || '-%' AND ${HAS_DAY}${sql}
       GROUP BY date ORDER BY date`
    )
    .all(String(year).padStart(4, '0'), ...params);
};

/** カレンダーに出せる年と、その年の枚数(新しい年が先) */
export const listCalendarYears = (
  db: Database,
  filter: AlbumFilter
): { year: number; count: number }[] => {
  const { sql, params } = albumFilterSql(filter);
  return db
    .query<{ year: number; count: number }, Param[]>(
      `SELECT CAST(substr(m.taken_at, 1, 4) AS INTEGER) AS year, count(*) AS count ${FILES}
       WHERE ${HAS_DAY}${sql} GROUP BY year ORDER BY year DESC`
    )
    .all(...params);
};

/** 選んだ日のまとめ: 枚数・撮影の最初と最後の時刻(時刻のあるものだけ)・GPS のある枚数 */
export type DaySummary = {
  count: number;
  /** `HH:mm`。時刻のある写真がなければ null */
  firstClock: string | null;
  lastClock: string | null;
  gpsCount: number;
};

export const getDaySummary = (
  db: Database,
  date: string,
  filter: AlbumFilter
): DaySummary => {
  const { sql, params } = albumFilterSql(filter);
  const row = db
    .query<
      {
        count: number;
        first: string | null;
        last: string | null;
        gps: number;
      },
      Param[]
    >(
      `SELECT count(*) AS count,
              min(CASE WHEN length(m.taken_at) >= 16 THEN substr(m.taken_at, 12, 5) END) AS first,
              max(CASE WHEN length(m.taken_at) >= 16 THEN substr(m.taken_at, 12, 5) END) AS last,
              sum(m.gps_lat IS NOT NULL) AS gps
       ${FILES} WHERE m.taken_at LIKE ? || '%' AND ${HAS_DAY}${sql}`
    )
    .get(date, ...params);
  return {
    count: row?.count ?? 0,
    firstClock: row?.first ?? null,
    lastClock: row?.last ?? null,
    gpsCount: row?.gps ?? 0,
  };
};
