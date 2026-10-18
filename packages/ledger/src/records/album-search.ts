import type { Database } from 'bun:sqlite';
import {
  type AlbumOrder,
  type AlbumPhoto,
  type PhotoRow,
  toAlbumPhoto,
} from './album-browse.ts';
import {
  type AlbumFilter,
  albumFilterSql,
  escapeLike,
  roundToPlaceCell,
  UNKNOWN_CAMERA,
} from './album-filter.ts';

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

type Param = string | number;

/** 条件に合う枚数 */
export const countFilteredPhotos = (
  db: Database,
  filter: AlbumFilter
): number => {
  const { sql, params } = albumFilterSql(filter);
  return (
    db
      .query<{ n: number }, Param[]>(
        `SELECT count(*) AS n ${FILES} WHERE 1 = 1${sql}`
      )
      .get(...params)?.n ?? 0
  );
};

/** 条件に合う写真(撮影日時の順。`order` の向き。日付のないものは、最後)。ページ送りつき */
export const listFilteredPhotos = (
  db: Database,
  filter: AlbumFilter,
  order: AlbumOrder,
  page: { limit: number; offset: number }
): AlbumPhoto[] => {
  const { sql, params } = albumFilterSql(filter);
  const direction = order === 'new' ? 'DESC' : 'ASC';
  return db
    .query<PhotoRow, Param[]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
              m.taken_at AS takenAt, m.width AS width, m.height AS height, m.duration_sec AS durationSec,
              (m.gps_lat IS NOT NULL) AS hasGps
       ${FILES} WHERE 1 = 1${sql}
       ORDER BY (m.taken_at IS NULL), m.taken_at ${direction}, f.library_file_id ${direction}
       LIMIT ? OFFSET ?`
    )
    .all(...params, page.limit, page.offset)
    .map(toAlbumPhoto);
};

/** 検索の候補。選ぶと、その条件が、検索の札になる */
export type SearchSuggestion =
  | { type: 'date'; value: string; label: string; count: number }
  | { type: 'name'; value: string; label: string; count: number }
  | { type: 'camera'; value: string; label: string; count: number }
  | {
      type: 'place';
      value: { lat: number; lon: number };
      label: string;
      count: number;
    };

/** 「2014年4月12日」「2014-04」「2014/4」などを、`YYYY` / `YYYY-MM` / `YYYY-MM-DD` にする。日付に読めなければ undefined */
export const parseDateQuery = (text: string): string | undefined => {
  const normalized = text
    .trim()
    .replace(/[年月/.]/g, '-')
    .replace(/日$/, '')
    .replace(/-+$/, '');
  const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(normalized);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (month === undefined) return year;
  const monthNumber = Number(month);
  if (monthNumber < 1 || monthNumber > 12) return undefined;
  const monthText = String(monthNumber).padStart(2, '0');
  if (day === undefined) return `${year}-${monthText}`;
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > 31) return undefined;
  return `${year}-${monthText}-${String(dayNumber).padStart(2, '0')}`;
};

/** 日付の条件の、表示 */
export const describeDate = (value: string): string => {
  const [year, month, day] = value.split('-');
  return `${year}年${month ? `${Number(month)}月` : ''}${day ? `${Number(day)}日` : ''}`;
};

/** 場所の格子の、表示(地名には、しない。座標の近く) */
export const describePlace = (place: { lat: number; lon: number }): string =>
  `${place.lat >= 0 ? '北緯' : '南緯'}${Math.abs(place.lat).toFixed(1)}° ${place.lon >= 0 ? '東経' : '西経'}${Math.abs(place.lon).toFixed(1)}° 付近`;

const NAME_EXAMPLES = 3;
const CAMERA_LIMIT = 4;
const PLACE_LIMIT = 4;
const PLACE_WORDS = /場所|gps|位置|place/i;

/**
 * 入力中の候補(日付・名前・カメラ・場所)。件数は、いまの条件に、その候補を足した結果の枚数(0 のものは、出さない)。
 * 入力が空なら、よく撮った場所と、カメラ。場所は、地名には変えず、座標のまとまりで出す。
 */
export const suggestSearch = (
  db: Database,
  text: string,
  filter: AlbumFilter
): SearchSuggestion[] => {
  const query = text.trim();
  const out: SearchSuggestion[] = [];
  const countWith = (extra: AlbumFilter): number =>
    countFilteredPhotos(db, { ...filter, ...extra });

  const date = parseDateQuery(query);
  if (date) {
    const count = countWith({ dates: [...(filter.dates ?? []), date] });
    if (count > 0)
      out.push({ type: 'date', value: date, label: describeDate(date), count });
  }

  if (query !== '') {
    const like = `%${escapeLike(query)}%`;
    const nameCount = countWith({ names: [...(filter.names ?? []), query] });
    if (nameCount > 0) {
      out.push({
        type: 'name',
        value: query,
        label: `名前に「${query}」を含む`,
        count: nameCount,
      });
      const examples = db
        .query<{ name: string }, Param[]>(
          `SELECT replace(f.rel_path, rtrim(f.rel_path, replace(f.rel_path, '/', '')), '') AS name, count(*) AS n
           ${FILES}
           WHERE lower(f.rel_path) LIKE lower(?) ESCAPE '\\'
           GROUP BY name HAVING lower(name) LIKE lower(?) ESCAPE '\\'
           ORDER BY n DESC, name LIMIT ${NAME_EXAMPLES}`
        )
        .all(like, like);
      for (const example of examples) {
        // 同じ名前の写真が、複数あるときも、1 つの候補
        const count = countWith({
          names: [...(filter.names ?? []), example.name],
        });
        if (count > 0 && example.name.toLowerCase() !== query.toLowerCase())
          out.push({
            type: 'name',
            value: example.name,
            label: example.name,
            count,
          });
      }
    }
    const cameras = db
      .query<{ model: string }, Param[]>(
        `SELECT DISTINCT m.camera_model AS model FROM media_metadata AS m
         WHERE m.camera_model LIKE ? ESCAPE '\\' ORDER BY m.camera_model LIMIT ${CAMERA_LIMIT}`
      )
      .all(like);
    for (const camera of cameras) {
      const count = countWith({
        cameras: [...(filter.cameras ?? []), camera.model],
      });
      if (count > 0)
        out.push({
          type: 'camera',
          value: camera.model,
          label: camera.model,
          count,
        });
    }
    if ('不明'.includes(query) && query !== '') {
      const count = countWith({
        cameras: [...(filter.cameras ?? []), UNKNOWN_CAMERA],
      });
      if (count > 0)
        out.push({
          type: 'camera',
          value: UNKNOWN_CAMERA,
          label: UNKNOWN_CAMERA,
          count,
        });
    }
  }

  if (query === '' || PLACE_WORDS.test(query)) {
    const { sql, params } = albumFilterSql(filter);
    const places = db
      .query<{ lat: number; lon: number; n: number }, Param[]>(
        `SELECT round(m.gps_lat, 1) AS lat, round(m.gps_lon, 1) AS lon, count(*) AS n ${FILES}
         WHERE m.gps_lat IS NOT NULL${sql}
         GROUP BY lat, lon ORDER BY n DESC, lat, lon LIMIT ${PLACE_LIMIT}`
      )
      .all(...params);
    for (const place of places) {
      const cell = {
        lat: roundToPlaceCell(place.lat),
        lon: roundToPlaceCell(place.lon),
      };
      const count = countWith({ places: [...(filter.places ?? []), cell] });
      if (count > 0)
        out.push({
          type: 'place',
          value: cell,
          label: describePlace(cell),
          count,
        });
    }
    if (query === '') {
      const cameras = db
        .query<{ model: string; n: number }, Param[]>(
          `SELECT m.camera_model AS model, count(*) AS n ${FILES}
           WHERE m.camera_model IS NOT NULL${sql}
           GROUP BY model ORDER BY n DESC, model LIMIT 3`
        )
        .all(...params);
      for (const camera of cameras)
        out.push({
          type: 'camera',
          value: camera.model,
          label: camera.model,
          count: countWith({
            cameras: [...(filter.cameras ?? []), camera.model],
          }),
        });
    }
  }
  return out;
};
