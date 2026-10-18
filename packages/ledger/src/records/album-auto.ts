import type { Database } from 'bun:sqlite';
import { EXTENSIONS_BY_KIND } from '@file-seiri/core';
import {
  type AlbumOrder,
  type AlbumPhoto,
  type PhotoRow,
  toAlbumPhoto,
} from './album-browse.ts';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;
const PHOTO_COLUMNS = `f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
  m.taken_at AS takenAt, m.width AS width, m.height AS height, m.duration_sec AS durationSec,
  (m.gps_lat IS NOT NULL) AS hasGps`;

type Param = string | number;

/** 条件に合う写真の、代表の 1 枚(サムネイルのあるもの。新しいものから) */
const coverOf = (db: Database, filter: AlbumFilter): AlbumPhoto | null => {
  const { sql, params } = albumFilterSql(filter);
  const row = db
    .query<PhotoRow, Param[]>(
      `SELECT ${PHOTO_COLUMNS} ${FILES}
       WHERE f.thumb_rel_path IS NOT NULL${sql}
       ORDER BY (m.taken_at IS NULL), m.taken_at DESC, f.library_file_id DESC LIMIT 1`
    )
    .get(...params);
  return row ? toAlbumPhoto(row) : null;
};

const countOf = (db: Database, filter: AlbumFilter): number => {
  const { sql, params } = albumFilterSql(filter);
  return (
    db
      .query<{ n: number }, Param[]>(
        `SELECT count(*) AS n ${FILES} WHERE 1 = 1${sql}`
      )
      .get(...params)?.n ?? 0
  );
};

/** 自動でまとめたできごと 1 件の、一覧用の姿 */
export type AutoEvent = {
  albumEventId: number;
  startAt: string;
  endAt: string;
  fileCount: number;
  /** いちばん多いカメラ(分からなければ null) */
  camera: string | null;
  gpsCount: number;
  videoCount: number;
  cover: AlbumPhoto | null;
};

/** できごとの一覧(開始の順。`order` が `new` なら、新しいものから)。`limit` 件 */
export const listLatestEvents = (
  db: Database,
  order: AlbumOrder,
  limit: number
): AutoEvent[] => {
  const direction = order === 'new' ? 'DESC' : 'ASC';
  const events = db
    .query<
      {
        albumEventId: number;
        startAt: string;
        endAt: string;
        fileCount: number;
        coverId: number | null;
      },
      [number]
    >(
      `SELECT album_event_id AS albumEventId, start_at AS startAt, end_at AS endAt, file_count AS fileCount,
              cover_library_file_id AS coverId
       FROM album_events ORDER BY start_at ${direction}, album_event_id ${direction} LIMIT ?`
    )
    .all(limit);
  const videoLikes = EXTENSIONS_BY_KIND.video
    .map(() => "lower(f.rel_path) LIKE ? ESCAPE '\\'")
    .join(' OR ');
  return events.map((event) => {
    const camera =
      db
        .query<{ model: string }, [number]>(
          `SELECT m.camera_model AS model ${FILES}
           WHERE f.album_event_id = ? AND m.camera_model IS NOT NULL
           GROUP BY m.camera_model ORDER BY count(*) DESC, m.camera_model LIMIT 1`
        )
        .get(event.albumEventId)?.model ?? null;
    const gpsCount =
      db
        .query<{ n: number }, [number]>(
          `SELECT count(*) AS n ${FILES} WHERE f.album_event_id = ? AND m.gps_lat IS NOT NULL`
        )
        .get(event.albumEventId)?.n ?? 0;
    const videoCount =
      db
        .query<{ n: number }, Param[]>(
          `SELECT count(*) AS n ${FILES} WHERE f.album_event_id = ? AND (${videoLikes})`
        )
        .get(
          event.albumEventId,
          ...EXTENSIONS_BY_KIND.video.map((extension) => `%.${extension}`)
        )?.n ?? 0;
    // 代表: できごとの代表(サムネイルがあれば)、なければ、サムネイルのある最初の 1 枚
    const coverRow =
      (event.coverId === null
        ? undefined
        : db
            .query<PhotoRow, [number]>(
              `SELECT ${PHOTO_COLUMNS} ${FILES}
               WHERE f.library_file_id = ? AND f.thumb_rel_path IS NOT NULL`
            )
            .get(event.coverId)) ??
      db
        .query<PhotoRow, [number]>(
          `SELECT ${PHOTO_COLUMNS} ${FILES}
           WHERE f.album_event_id = ? AND f.thumb_rel_path IS NOT NULL
           ORDER BY m.taken_at, f.library_file_id LIMIT 1`
        )
        .get(event.albumEventId);
    return {
      albumEventId: event.albumEventId,
      startAt: event.startAt,
      endAt: event.endAt,
      fileCount: event.fileCount,
      camera,
      gpsCount,
      videoCount,
      cover: coverRow ? toAlbumPhoto(coverRow) : null,
    };
  });
};

/** 自動アルバムの種類(切り口)。少数に絞る */
export type AutoAlbumKind =
  | 'video'
  | 'raw'
  | 'live'
  | 'gps'
  | 'camera'
  | 'fallback'
  | 'undated';

/** 自動アルバム 1 冊。`filter` が、その中身を決める条件(押すと、この条件の「すべて」へ) */
export type AutoAlbum = {
  kind: AutoAlbumKind;
  title: string;
  /** 件数。ライブフォトだけ、「組」(同名グループ)で数える */
  count: number;
  unit: '枚' | '本' | '組';
  cover: AlbumPhoto | null;
  filter: AlbumFilter;
};

/** カメラ別に出す、機種の数(少数に絞る) */
const CAMERA_ALBUMS = 2;

/**
 * 自動アルバムの一覧(できごと以外)。写真のない切り口は、出さない。
 * 動画・RAW・ライブフォト・場所のある写真・カメラ別(多い機種から少数)・日付フォールバック・日付なし。
 */
export const listAutoAlbums = (db: Database): AutoAlbum[] => {
  const albums: AutoAlbum[] = [];
  const add = (
    kind: AutoAlbumKind,
    title: string,
    filter: AlbumFilter,
    unit: AutoAlbum['unit'] = '枚',
    count = countOf(db, filter)
  ): void => {
    if (count > 0)
      albums.push({
        kind,
        title,
        count,
        unit,
        cover: coverOf(db, filter),
        filter,
      });
  };
  add('video', '動画', { kinds: ['video'] }, '本');
  add('raw', 'RAW', { kinds: ['raw'] });
  const live: AlbumFilter = { livePhotos: true };
  const { sql, params } = albumFilterSql(live);
  const livePairs =
    db
      .query<{ n: number }, Param[]>(
        `SELECT count(DISTINCT f.group_id) AS n ${FILES} WHERE 1 = 1${sql}`
      )
      .get(...params)?.n ?? 0;
  add('live', 'ライブフォト', live, '組', livePairs);
  add('gps', '場所のある写真', { gps: true });
  const cameras = db
    .query<{ model: string }, [number]>(
      `SELECT m.camera_model AS model ${FILES} WHERE m.camera_model IS NOT NULL
       GROUP BY m.camera_model ORDER BY count(*) DESC, m.camera_model LIMIT ?`
    )
    .all(CAMERA_ALBUMS);
  for (const camera of cameras)
    add('camera', camera.model, { cameras: [camera.model] });
  add('fallback', '日付フォールバック', { dateSources: ['json', 'filename'] });
  add('undated', '日付なし', { precisions: ['none', 'invalid'] });
  return albums;
};

/** 日付が不明なものの区分(精度ごと)と、枚数 */
export type DateGap = {
  key: 'time' | 'day' | 'monthday' | 'none';
  label: string;
  /** この区分に入る、日付の精度(「すべて」を、この条件で開く) */
  precisions: string[];
  count: number;
};

const DATE_GAPS: Omit<DateGap, 'count'>[] = [
  { key: 'time', label: '時刻不明', precisions: ['date'] },
  { key: 'day', label: '日不明', precisions: ['month'] },
  { key: 'monthday', label: '月日不明', precisions: ['year'] },
  { key: 'none', label: '日付なし', precisions: ['none', 'invalid'] },
];

/** 日付が不明なものの、区分ごとの枚数(0 の区分は、出さない) */
export const listDateGaps = (db: Database): DateGap[] => {
  const counts = new Map(
    db
      .query<{ precision: string; n: number }, []>(
        `SELECT m.date_precision AS precision, count(*) AS n ${FILES} GROUP BY m.date_precision`
      )
      .all()
      .map((row) => [row.precision, row.n])
  );
  return DATE_GAPS.map((gap) => ({
    ...gap,
    count: gap.precisions.reduce((sum, p) => sum + (counts.get(p) ?? 0), 0),
  })).filter((gap) => gap.count > 0);
};
