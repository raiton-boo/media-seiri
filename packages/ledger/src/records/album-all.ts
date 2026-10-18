import type { Database } from 'bun:sqlite';
import {
  type AlbumOrder,
  type AlbumPhoto,
  type PhotoRow,
  toAlbumPhoto,
} from './album-browse.ts';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

/**
 * 「すべて」の区画: 撮影日時の年月ごとの、枚数。
 * `year` が 0 なら、日付のないもの。`month` が 0 なら、月が分からないもの(精度 `year`)。
 */
export type AlbumSection = { year: number; month: number; count: number };

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

const YEAR_SQL = `CASE WHEN m.taken_at IS NULL THEN 0 ELSE CAST(substr(m.taken_at, 1, 4) AS INTEGER) END`;
const MONTH_SQL = `CASE WHEN m.taken_at IS NULL OR length(m.taken_at) < 7 THEN 0 ELSE CAST(substr(m.taken_at, 6, 2) AS INTEGER) END`;

/**
 * 区画の一覧(表示の順): 年は、`order` の向き。年の中では、月も、その向き(月が分からないものは、年の最後)。
 * 日付のないものは、いつも、いちばん最後。絞り込みに合うものだけを数える(0 件の区画は、出さない)。
 */
export const listAlbumSections = (
  db: Database,
  filter: AlbumFilter,
  order: AlbumOrder
): AlbumSection[] => {
  const { sql, params } = albumFilterSql(filter);
  const direction = order === 'new' ? 'DESC' : 'ASC';
  return db
    .query<AlbumSection, (string | number)[]>(
      `SELECT year, month, count(*) AS count FROM (
         SELECT ${YEAR_SQL} AS year, ${MONTH_SQL} AS month ${FILES} WHERE 1 = 1${sql}
       )
       GROUP BY year, month
       ORDER BY (year = 0) ASC, year ${direction}, (month = 0) ASC, month ${direction}`
    )
    .all(...params);
};

/** 1 つの区画の写真(撮影日時の順。`order` の向き)。`limit` は、1 つの区画の上限(月が、極端に多いときの、安全のため) */
export const listSectionPhotos = (
  db: Database,
  filter: AlbumFilter,
  section: { year: number; month: number },
  order: AlbumOrder,
  limit: number
): AlbumPhoto[] => {
  const { sql, params } = albumFilterSql(filter);
  const direction = order === 'new' ? 'DESC' : 'ASC';
  return db
    .query<PhotoRow, (string | number)[]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
              m.taken_at AS takenAt, m.width AS width, m.height AS height, m.duration_sec AS durationSec,
              (m.gps_lat IS NOT NULL) AS hasGps
       ${FILES}
       WHERE ${YEAR_SQL} = ? AND ${MONTH_SQL} = ?${sql}
       ORDER BY m.taken_at ${direction}, f.library_file_id ${direction}
       LIMIT ?`
    )
    .all(section.year, section.month, ...params, limit)
    .map(toAlbumPhoto);
};
