import type { Database } from 'bun:sqlite';
import { classifyFile } from '@file-seiri/core';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

/** 並び順: 新しい順(既定)/ 古い順 */
export type AlbumOrder = 'new' | 'old';

const direction = (order: AlbumOrder): 'DESC' | 'ASC' =>
  order === 'new' ? 'DESC' : 'ASC';

/** 机に置く写真(サムネイルがあるもの) */
export type AlbumPhoto = {
  libraryFileId: number;
  relPath: string;
  /** `thumbs/` からの相対パス。まだ作っていなければ null */
  thumbRelPath: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  /** 種類: 写真・動画・RAW(拡張子から) */
  kind: 'photo' | 'video' | 'raw';
  hasGps: boolean;
  durationSec: number | null;
};

export type PhotoRow = Omit<AlbumPhoto, 'kind' | 'hasGps'> & { hasGps: number };

const PHOTO_COLUMNS = `f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
  m.taken_at AS takenAt, m.width AS width, m.height AS height, m.duration_sec AS durationSec,
  (m.gps_lat IS NOT NULL) AS hasGps`;

/** SQL の行を、机に置く写真にする(種類は、拡張子から。GPS は、真偽に) */
export const toAlbumPhoto = (row: PhotoRow): AlbumPhoto => {
  const kind = classifyFile(row.relPath);
  return {
    ...row,
    kind: kind === 'video' || kind === 'raw' ? kind : 'photo',
    hasGps: row.hasGps === 1,
  };
};

// ライブラリのファイルのうち、メタデータのあるもの(写真・動画・RAW。サイドカーは、メタデータがないため、入らない)
const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

/** 年ごとの枚数(撮影日時のあるもの)と、日付のないものの枚数 */
export const listYearCounts = (
  db: Database,
  order: AlbumOrder,
  filter: AlbumFilter = {}
): {
  years: { year: number; count: number }[];
  undated: number;
  total: number;
} => {
  const narrow = albumFilterSql(filter);
  const years = db
    .query<{ year: number; count: number }, (string | number)[]>(
      `SELECT CAST(substr(m.taken_at, 1, 4) AS INTEGER) AS year, count(*) AS count
       ${FILES} WHERE m.taken_at IS NOT NULL${narrow.sql}
       GROUP BY year ORDER BY year ${direction(order)}`
    )
    .all(...narrow.params);
  const undated =
    db
      .query<{ n: number }, (string | number)[]>(
        `SELECT count(*) AS n ${FILES} WHERE m.taken_at IS NULL${narrow.sql}`
      )
      .get(...narrow.params)?.n ?? 0;
  return {
    years,
    undated,
    total: years.reduce((sum, item) => sum + item.count, 0) + undated,
  };
};

/** 月ごとの、枚数と、代表の 1 枚(その月の、GPS つきを優先し、なければ、いちばん早いもの。サムネイルがあるもの) */
export type MonthSummary = {
  month: number;
  count: number;
  cover: AlbumPhoto | null;
};

/** 1 年の、12 か月ぶん(枚数 0 の月も含む)。`order` は、月の並び順 */
export const listMonthSummaries = (
  db: Database,
  year: number,
  order: AlbumOrder,
  filter: AlbumFilter = {}
): MonthSummary[] => {
  const narrow = albumFilterSql(filter);
  const prefix = `${String(year).padStart(4, '0')}-`;
  const counts = new Map(
    db
      .query<{ month: number; count: number }, (string | number)[]>(
        `SELECT CAST(substr(m.taken_at, 6, 2) AS INTEGER) AS month, count(*) AS count
         ${FILES} WHERE m.taken_at LIKE ? || '%' AND length(m.taken_at) >= 7${narrow.sql}
         GROUP BY month`
      )
      .all(prefix, ...narrow.params)
      .map((row) => [row.month, row.count])
  );
  const covers = new Map(
    db
      .query<PhotoRow & { month: number }, (string | number)[]>(
        `SELECT * FROM (
           SELECT ${PHOTO_COLUMNS}, CAST(substr(m.taken_at, 6, 2) AS INTEGER) AS month,
                  row_number() OVER (
                    PARTITION BY substr(m.taken_at, 6, 2)
                    ORDER BY (m.gps_lat IS NULL), m.taken_at, f.library_file_id) AS rn
           ${FILES}
           WHERE m.taken_at LIKE ? || '%' AND length(m.taken_at) >= 7 AND f.thumb_rel_path IS NOT NULL${narrow.sql}
         ) WHERE rn = 1`
      )
      .all(prefix, ...narrow.params)
      .map((row) => [row.month, toAlbumPhoto(row)])
  );
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    count: counts.get(index + 1) ?? 0,
    cover: covers.get(index + 1) ?? null,
  }));
  return order === 'new' ? months.reverse() : months;
};

/** できごと 1 件の、机に置く姿(束: 代表を先頭に、最大 3 枚) */
export type EventStack = {
  albumEventId: number;
  startAt: string;
  endAt: string;
  fileCount: number;
  /** 束にする写真(代表が先頭。サムネイルのあるもの。最大 3 枚) */
  photos: AlbumPhoto[];
};

const STACK_SIZE = 3;

/** 1 か月のできごと(開始の順。`order` が `new` なら、新しいものから) */
export const listEventStacks = (
  db: Database,
  year: number,
  month: number,
  order: AlbumOrder,
  filter: AlbumFilter = {}
): EventStack[] => {
  const narrow = albumFilterSql(filter);
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const events = db
    .query<
      {
        albumEventId: number;
        startAt: string;
        endAt: string;
        fileCount: number;
      },
      (string | number)[]
    >(
      // 枚数は、条件に合うものだけ数える(合うものがないできごとは、出さない)
      `SELECT e.album_event_id AS albumEventId, e.start_at AS startAt, e.end_at AS endAt, count(*) AS fileCount
       FROM album_events AS e
       JOIN library_files AS f ON f.album_event_id = e.album_event_id
       JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE substr(e.start_at, 1, 7) = ?${narrow.sql}
       GROUP BY e.album_event_id
       ORDER BY e.start_at ${direction(order)}, e.album_event_id ${direction(order)}`
    )
    .all(prefix, ...narrow.params);
  const photos = db
    .query<PhotoRow & { albumEventId: number }, (string | number)[]>(
      `SELECT * FROM (
         SELECT ${PHOTO_COLUMNS}, e.album_event_id AS albumEventId,
                row_number() OVER (
                  PARTITION BY e.album_event_id
                  ORDER BY (f.library_file_id = e.cover_library_file_id) DESC, m.taken_at, f.library_file_id) AS rn
         FROM album_events AS e
         JOIN library_files AS f ON f.album_event_id = e.album_event_id
         JOIN media_metadata AS m ON m.content_id = f.content_id
         WHERE substr(e.start_at, 1, 7) = ? AND f.thumb_rel_path IS NOT NULL${narrow.sql}
       ) WHERE rn <= ${STACK_SIZE}`
    )
    .all(prefix, ...narrow.params);
  const byEvent = new Map<number, AlbumPhoto[]>();
  for (const row of photos) {
    byEvent.set(row.albumEventId, [
      ...(byEvent.get(row.albumEventId) ?? []),
      toAlbumPhoto(row),
    ]);
  }
  return events.map((event) => ({
    ...event,
    photos: byEvent.get(event.albumEventId) ?? [],
  }));
};

/** できごとに入らない写真(日付が月までしか分からないものなど。できごとは、日まで分かる写真から作るため) */
export type LooseMonthPhotos = { count: number; photos: AlbumPhoto[] };

/**
 * ある月の、できごとに入らない写真。月の机は、できごとの束だけを置くため、これを足さないと、
 * 「月までしか分からない写真」だけの月が、空に見える。`limit` 枚まで(撮影日時の順)。
 */
export const listLooseMonthPhotos = (
  db: Database,
  year: number,
  month: number,
  order: AlbumOrder,
  filter: AlbumFilter = {},
  limit = 60
): LooseMonthPhotos => {
  const narrow = albumFilterSql(filter);
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const where = `WHERE m.taken_at LIKE ? || '%' AND length(m.taken_at) >= 7 AND f.album_event_id IS NULL
     AND lower(f.rel_path) NOT LIKE '%.xmp'${narrow.sql}`;
  const count =
    db
      .query<{ n: number }, (string | number)[]>(
        `SELECT count(*) AS n ${FILES} ${where}`
      )
      .get(prefix, ...narrow.params)?.n ?? 0;
  const photos = db
    .query<PhotoRow, (string | number)[]>(
      `SELECT ${PHOTO_COLUMNS} ${FILES} ${where}
       ORDER BY m.taken_at ${direction(order)}, f.library_file_id ${direction(order)} LIMIT ?`
    )
    .all(prefix, ...narrow.params, limit)
    .map(toAlbumPhoto);
  return { count, photos };
};

export type EventDetail = {
  albumEventId: number;
  startAt: string;
  endAt: string;
  fileCount: number;
  /** いちばん多いカメラ(機種名)。分からなければ null */
  camera: string | null;
  /** 写真(撮影日時の順。`order` が `new` なら、新しいものから) */
  photos: AlbumPhoto[];
  /** 前後のできごと(`order` の向きで、前・次) */
  previous: { albumEventId: number; startAt: string } | null;
  next: { albumEventId: number; startAt: string } | null;
};

/** できごと 1 件と、その写真(`limit`・`offset` で、ページ送り)。前後のできごとを添える */
export const getEventDetail = (
  db: Database,
  albumEventId: number,
  order: AlbumOrder,
  page: { limit: number; offset: number },
  filter: AlbumFilter = {}
): EventDetail | undefined => {
  const narrow = albumFilterSql(filter);
  const event = db
    .query<
      {
        albumEventId: number;
        startAt: string;
        endAt: string;
        fileCount: number;
      },
      [number]
    >(
      `SELECT album_event_id AS albumEventId, start_at AS startAt, end_at AS endAt, file_count AS fileCount
       FROM album_events WHERE album_event_id = ?`
    )
    .get(albumEventId);
  if (!event) return undefined;
  const photos = db
    .query<PhotoRow, (string | number)[]>(
      `SELECT ${PHOTO_COLUMNS} ${FILES} WHERE f.album_event_id = ?${narrow.sql}
       ORDER BY m.taken_at ${direction(order)}, f.library_file_id ${direction(order)}
       LIMIT ? OFFSET ?`
    )
    .all(albumEventId, ...narrow.params, page.limit, page.offset)
    .map(toAlbumPhoto);
  // 条件があるときの枚数は、合うものだけ
  const fileCount =
    narrow.sql === ''
      ? event.fileCount
      : (db
          .query<{ n: number }, (string | number)[]>(
            `SELECT count(*) AS n ${FILES} WHERE f.album_event_id = ?${narrow.sql}`
          )
          .get(albumEventId, ...narrow.params)?.n ?? 0);
  const camera =
    db
      .query<{ model: string }, [number]>(
        `SELECT m.camera_model AS model ${FILES}
         WHERE f.album_event_id = ? AND m.camera_model IS NOT NULL
         GROUP BY m.camera_model ORDER BY count(*) DESC, m.camera_model LIMIT 1`
      )
      .get(albumEventId)?.model ?? null;
  const neighbor = (cmp: '<' | '>', sort: 'DESC' | 'ASC') =>
    db
      .query<
        { albumEventId: number; startAt: string },
        [string, string, number]
      >(
        `SELECT album_event_id AS albumEventId, start_at AS startAt FROM album_events
         WHERE start_at ${cmp} ? OR (start_at = ? AND album_event_id ${cmp} ?)
         ORDER BY start_at ${sort}, album_event_id ${sort} LIMIT 1`
      )
      .get(event.startAt, event.startAt, event.albumEventId) ?? null;
  // 「新しい順」では、前 = より新しい、次 = より古い
  const newer = neighbor('>', 'ASC');
  const older = neighbor('<', 'DESC');
  return {
    ...event,
    fileCount,
    camera,
    photos,
    previous: order === 'new' ? newer : older,
    next: order === 'new' ? older : newer,
  };
};

/** 去年の今日: 今日と同じ月日の、過去の年のできごと(新しい年から、`limit` 件) */
export type OnThisDay = {
  albumEventId: number;
  startAt: string;
  fileCount: number;
  cover: AlbumPhoto | null;
};

export const listOnThisDay = (
  db: Database,
  month: number,
  day: number,
  beforeYear: number,
  limit: number
): OnThisDay[] => {
  const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const events = db
    .query<
      {
        albumEventId: number;
        startAt: string;
        fileCount: number;
        coverId: number | null;
      },
      [string, number, number]
    >(
      `SELECT album_event_id AS albumEventId, start_at AS startAt, file_count AS fileCount,
              cover_library_file_id AS coverId
       FROM album_events
       WHERE substr(start_at, 6, 5) = ? AND CAST(substr(start_at, 1, 4) AS INTEGER) < ?
       ORDER BY start_at DESC LIMIT ?`
    )
    .all(monthDay, beforeYear, limit);
  return events.map((event) => {
    // 代表の写真がなければ、そのできごとの先頭の写真
    const row =
      event.coverId === null
        ? db
            .query<PhotoRow, [number]>(
              `SELECT ${PHOTO_COLUMNS} ${FILES} WHERE f.album_event_id = ?
               ORDER BY m.taken_at, f.library_file_id LIMIT 1`
            )
            .get(event.albumEventId)
        : db
            .query<PhotoRow, [number]>(
              `SELECT ${PHOTO_COLUMNS} ${FILES} WHERE f.library_file_id = ?`
            )
            .get(event.coverId);
    return {
      albumEventId: event.albumEventId,
      startAt: event.startAt,
      fileCount: event.fileCount,
      cover: row ? toAlbumPhoto(row) : null,
    };
  });
};

/**
 * 今日の一枚: サムネイルのある写真から、`seed` で、1 枚を選ぶ(同じ `seed` なら、同じ 1 枚。登録の順に並べて、`seed` の余りの位置)。
 * `seed` は、日付と、「別の 1 枚」の回数から、呼び出し側が決める。
 */
export const pickPhotoOfDay = (
  db: Database,
  seed: number
): AlbumPhoto | null => {
  const total =
    db
      .query<{ n: number }, []>(
        `SELECT count(*) AS n ${FILES} WHERE f.thumb_rel_path IS NOT NULL`
      )
      .get()?.n ?? 0;
  if (total === 0) return null;
  const row = db
    .query<PhotoRow, [number]>(
      `SELECT ${PHOTO_COLUMNS} ${FILES} WHERE f.thumb_rel_path IS NOT NULL
       ORDER BY f.library_file_id LIMIT 1 OFFSET ?`
    )
    .get(((seed % total) + total) % total);
  return row ? toAlbumPhoto(row) : null;
};
