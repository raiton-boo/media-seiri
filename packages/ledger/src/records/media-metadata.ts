import type { Database } from 'bun:sqlite';
import {
  type DatePrecision,
  type DateResolution,
  type DateSource,
  formatTakenAt,
  toMtimeMs,
} from '@file-seiri/core';

/** 日付以外の、メタデータ(取れなかった項目は、省く) */
export type MediaDetails = {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  gpsLat?: number;
  gpsLon?: number;
  gpsAlt?: number;
};

export type MediaMetadataInput = MediaDetails & {
  contentId: number;
  /** `resolveDate` の結果。撮影日時・精度・取得元・理由・参考の更新日は、ここから決める */
  date: DateResolution;
};

export type MediaMetadata = {
  contentId: number;
  /** `formatTakenAt` の形式。`none` と `invalid` のときは、null */
  takenAt: string | null;
  datePrecision: DatePrecision;
  dateSource: DateSource;
  dateReason: string;
  mtimeRefMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsAlt: number | null;
};

const COLUMNS = `content_id AS contentId, taken_at AS takenAt, date_precision AS datePrecision,
  date_source AS dateSource, date_reason AS dateReason, mtime_ref_ms AS mtimeRefMs,
  camera_make AS cameraMake, camera_model AS cameraModel, lens_model AS lensModel, width, height,
  duration_sec AS durationSec, gps_lat AS gpsLat, gps_lon AS gpsLon, gps_alt AS gpsAlt`;

/** 内容ごとのメタデータを保存する。同じ内容があれば、上書きする */
export const upsertMediaMetadata = (
  db: Database,
  input: MediaMetadataInput
): void => {
  const { date } = input;
  db.query(
    `INSERT OR REPLACE INTO media_metadata
       (content_id, taken_at, date_precision, date_source, date_reason, mtime_ref_ms,
        camera_make, camera_model, lens_model, width, height, duration_sec, gps_lat, gps_lon, gps_alt)
     VALUES ($contentId, $takenAt, $datePrecision, $dateSource, $dateReason, $mtimeRefMs,
        $cameraMake, $cameraModel, $lensModel, $width, $height, $durationSec, $gpsLat, $gpsLon, $gpsAlt)`
  ).run({
    contentId: input.contentId,
    takenAt: date.parts ? formatTakenAt(date.parts) : null,
    datePrecision: date.precision,
    dateSource: date.source,
    dateReason: date.reason,
    mtimeRefMs: date.referenceMtime
      ? toMtimeMs(date.referenceMtime.getTime())
      : null,
    cameraMake: input.cameraMake ?? null,
    cameraModel: input.cameraModel ?? null,
    lensModel: input.lensModel ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    durationSec: input.durationSec ?? null,
    gpsLat: input.gpsLat ?? null,
    gpsLon: input.gpsLon ?? null,
    gpsAlt: input.gpsAlt ?? null,
  });
};

export const getMediaMetadata = (
  db: Database,
  contentId: number
): MediaMetadata | undefined =>
  db
    .query<MediaMetadata, [number]>(
      `SELECT ${COLUMNS} FROM media_metadata WHERE content_id = ?`
    )
    .get(contentId) ?? undefined;
