import type { Database } from 'bun:sqlite';
import { classifyFile, type FileKind } from '@file-seiri/core';
import {
  type AlbumOrder,
  type AlbumPhoto,
  type PhotoRow,
  toAlbumPhoto,
} from './album-browse.ts';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

/** 同名グループの 1 ファイル(JPG・RAW・XMP など) */
export type GroupMember = {
  libraryFileId: number;
  relPath: string;
  kind: FileKind;
  thumbRelPath: string | null;
  sizeBytes: number;
};

/** 拡大表示の情報 */
export type PhotoDetail = {
  libraryFileId: number;
  relPath: string;
  kind: FileKind;
  thumbRelPath: string | null;
  sizeBytes: number;
  hash: string;
  isRepaired: boolean;
  /** メタデータ(サイドカーなど、ないものは null) */
  takenAt: string | null;
  datePrecision: string | null;
  dateSource: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  gps: { lat: number; lon: number } | null;
  /** できごと(あれば) */
  event: { albumEventId: number; startAt: string; fileCount: number } | null;
  /** 同名グループ(自分を含む。撮影の種類の順: 写真・動画・RAW・サイドカー) */
  group: GroupMember[];
};

type DetailRow = {
  libraryFileId: number;
  relPath: string;
  thumbRelPath: string | null;
  sizeBytes: number;
  hash: string;
  isRepaired: number;
  groupId: number;
  takenAt: string | null;
  datePrecision: string | null;
  dateSource: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  albumEventId: number | null;
};

const KIND_ORDER: Record<FileKind, number> = {
  photo: 0,
  video: 1,
  raw: 2,
  xmp: 3,
  json: 4,
  unsupported: 5,
};

/** 写真 1 枚の情報。なければ undefined */
export const getPhotoDetail = (
  db: Database,
  libraryFileId: number
): PhotoDetail | undefined => {
  const row = db
    .query<DetailRow, [number]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
              c.size_bytes AS sizeBytes, c.hash AS hash, f.is_repaired AS isRepaired, f.group_id AS groupId,
              m.taken_at AS takenAt, m.date_precision AS datePrecision, m.date_source AS dateSource,
              m.camera_make AS cameraMake, m.camera_model AS cameraModel, m.lens_model AS lensModel,
              m.width AS width, m.height AS height, m.duration_sec AS durationSec,
              m.gps_lat AS gpsLat, m.gps_lon AS gpsLon, f.album_event_id AS albumEventId
       FROM library_files AS f
       JOIN contents AS c ON c.content_id = f.content_id
       LEFT JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE f.library_file_id = ?`
    )
    .get(libraryFileId);
  if (!row) return undefined;
  const group = db
    .query<Omit<GroupMember, 'kind'>, [number]>(
      `SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
              c.size_bytes AS sizeBytes
       FROM library_files AS f JOIN contents AS c ON c.content_id = f.content_id
       WHERE f.group_id = ? ORDER BY f.rel_path`
    )
    .all(row.groupId)
    .map((member) => ({ ...member, kind: classifyFile(member.relPath) }))
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.relPath.localeCompare(b.relPath)
    );
  const event =
    row.albumEventId === null
      ? null
      : (db
          .query<
            { albumEventId: number; startAt: string; fileCount: number },
            [number]
          >(
            `SELECT album_event_id AS albumEventId, start_at AS startAt, file_count AS fileCount
             FROM album_events WHERE album_event_id = ?`
          )
          .get(row.albumEventId) ?? null);
  return {
    libraryFileId: row.libraryFileId,
    relPath: row.relPath,
    kind: classifyFile(row.relPath),
    thumbRelPath: row.thumbRelPath,
    sizeBytes: row.sizeBytes,
    hash: row.hash,
    isRepaired: row.isRepaired === 1,
    takenAt: row.takenAt,
    datePrecision: row.datePrecision,
    dateSource: row.dateSource,
    cameraMake: row.cameraMake,
    cameraModel: row.cameraModel,
    lensModel: row.lensModel,
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    gps:
      row.gpsLat !== null && row.gpsLon !== null
        ? { lat: row.gpsLat, lon: row.gpsLon }
        : null,
    event,
    group,
  };
};

/** 前後の写真の並び(フィルムストリップ) */
export type PhotoStrip = {
  /** 条件に合う写真の、全部の枚数 */
  total: number;
  /** この写真の、何枚目か(1 から)。条件に合わない写真なら null(前後には、動けない) */
  position: number | null;
  /** 表示の順で、この写真の前後 `radius` 枚(この写真を含む) */
  photos: AlbumPhoto[];
};

/**
 * 条件に合う写真を、`listFilteredPhotos` と同じ順に並べたときの、この写真の位置と、前後 `radius` 枚。
 * 条件に合わない写真(URL を手で書き換えたときなど)は、位置なし・前後なし。
 */
export const getPhotoStrip = (
  db: Database,
  libraryFileId: number,
  filter: AlbumFilter,
  order: AlbumOrder,
  radius: number
): PhotoStrip => {
  const { sql, params } = albumFilterSql(filter);
  const direction = order === 'new' ? 'DESC' : 'ASC';
  const ranked = `
    WITH ranked AS (
      SELECT f.library_file_id AS libraryFileId, f.rel_path AS relPath, f.thumb_rel_path AS thumbRelPath,
             m.taken_at AS takenAt, m.width AS width, m.height AS height, m.duration_sec AS durationSec,
             (m.gps_lat IS NOT NULL) AS hasGps,
             row_number() OVER (
               ORDER BY (m.taken_at IS NULL), m.taken_at ${direction}, f.library_file_id ${direction}) AS rn
      FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id
      WHERE 1 = 1${sql}
    )`;
  const total =
    db
      .query<{ n: number }, (string | number)[]>(
        `${ranked} SELECT count(*) AS n FROM ranked`
      )
      .get(...params)?.n ?? 0;
  const position =
    db
      .query<{ rn: number }, (string | number)[]>(
        `${ranked} SELECT rn FROM ranked WHERE libraryFileId = ?`
      )
      .get(...params, libraryFileId)?.rn ?? null;
  if (position === null) return { total, position: null, photos: [] };
  const photos = db
    .query<PhotoRow, (string | number)[]>(
      `${ranked} SELECT libraryFileId, relPath, thumbRelPath, takenAt, width, height, durationSec, hasGps
       FROM ranked WHERE rn BETWEEN ? AND ? ORDER BY rn`
    )
    .all(...params, Math.max(1, position - radius), position + radius)
    .map(toAlbumPhoto);
  return { total, position, photos };
};
