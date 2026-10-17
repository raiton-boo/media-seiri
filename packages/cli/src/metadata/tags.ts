import type { DateInput, DateParts, RawDateTime } from '@file-seiri/core';
import type { MediaDetails } from '@file-seiri/ledger';
import { ExifDate, ExifDateTime, type Tags } from 'exiftool-vendored';

/** 取得したメタデータ。`dates` は `core` の `DateInput` に、そのまま足せる */
export type ExtractedMetadata = {
  dates: Pick<DateInput, 'exif' | 'videoCreateDateUtc'>;
  /** 台帳の `media_metadata` に持つ、日付以外の項目 */
  details: MediaDetails;
  /** ExifTool の警告(切れた画像など)。破損の検出で使う */
  warning?: string;
};

/** 動画の日付のタグ。優先順(仕様書 §3-1: 動画は `CreateDate`)。`DateTimeOriginal` は、mkv・webm の撮影日時 */
const VIDEO_DATE_TAGS = [
  'CreateDate',
  'MediaCreateDate',
  'TrackCreateDate',
  'DateTimeOriginal',
] as const;

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const isDateValue = (value: unknown): value is ExifDateTime | ExifDate =>
  value instanceof ExifDateTime || value instanceof ExifDate;

/**
 * ExifTool の日付のタグを、`core` の `RawDateTime` にする。タグがなければ undefined。
 * 日付として解釈できなかった値(`0000:00:00 00:00:00` など)は、文字列や数値のまま返るため、`unparsable`。
 * 写真の日時は、書かれている部品をそのまま使う(オフセットがあれば、撮影地の時刻)。
 */
const toRawDateTime = (value: unknown): RawDateTime | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value instanceof ExifDateTime) {
    return {
      kind: 'value',
      parts: {
        year: value.year,
        month: value.month,
        day: value.day,
        hour: value.hour,
        minute: value.minute,
        second: value.second,
      },
    };
  }
  if (value instanceof ExifDate) {
    return {
      kind: 'value',
      parts: { year: value.year, month: value.month, day: value.day },
    };
  }
  return { kind: 'unparsable' };
};

/** 時刻のずれを含む日時を、UTC の部品にする(本機のタイムゾーンに、左右されない) */
const toUtcParts = (value: ExifDateTime): DateParts | undefined => {
  const millis = value.toMillis();
  if (!Number.isFinite(millis)) return undefined;
  const date = new Date(millis);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
};

/**
 * 動画の日付を読む。
 * - 時刻のずれを含む日時(QuickTime・mkv の UTC)は、UTC の瞬間にして `videoCreateDateUtc` へ。
 *   `exiftool-vendored` は、QuickTime の UTC を本機のタイムゾーンに直して返すことがあるため、
 *   書かれた部品ではなく、瞬間(`toMillis()`)から、UTC の部品を作る。
 * - ずれのない日時・日付だけの値は、UTC とは言えないため、ローカル時刻として `exif.createDate` へ。
 * - どれも解釈できなかったときは、`videoCreateDateUtc` を `unparsable` にする。
 */
const readVideoDates = (tags: Tags): ExtractedMetadata['dates'] => {
  let hasUnparsable = false;
  for (const name of VIDEO_DATE_TAGS) {
    const value: unknown = tags[name];
    if (value === undefined || value === null) continue;
    if (!isDateValue(value)) {
      hasUnparsable = true;
      continue;
    }
    if (value instanceof ExifDateTime && value.hasZone) {
      const parts = toUtcParts(value);
      if (parts) return { videoCreateDateUtc: { kind: 'value', parts } };
      hasUnparsable = true;
      continue;
    }
    const local = toRawDateTime(value);
    if (local) return { exif: { createDate: local } };
  }
  return hasUnparsable ? { videoCreateDateUtc: { kind: 'unparsable' } } : {};
};

/**
 * 写真・RAW の日付を読む。`DateTimeOriginal`、`CreateDate` の順。
 * ExifTool では、EXIF の DateTimeDigitized は、`CreateDate` という名前なので、`dateTimeDigitized` は使わない。
 */
const readPhotoDates = (tags: Tags): ExtractedMetadata['dates'] => {
  const dateTimeOriginal = toRawDateTime(tags.DateTimeOriginal);
  const createDate = toRawDateTime(tags.CreateDate);
  if (!dateTimeOriginal && !createDate) return {};
  return {
    exif: {
      ...(dateTimeOriginal ? { dateTimeOriginal } : {}),
      ...(createDate ? { createDate } : {}),
    },
  };
};

const textOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const nonNegative = (value: unknown): number | undefined => {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
};

/**
 * 台帳の制約(緯度 -90〜90・経度 -180〜180)に合わない値は、捨てる。
 * 緯度・経度がどちらも 0 のものは、位置情報が取れなかったカメラが書く値(の可能性が高い)ため、捨てる。
 */
const readGps = (
  tags: Tags
): Pick<MediaDetails, 'gpsLat' | 'gpsLon' | 'gpsAlt'> => {
  const lat = finiteNumber(tags.GPSLatitude);
  const lon = finiteNumber(tags.GPSLongitude);
  if (lat === undefined || lon === undefined) return {};
  if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lon) > MAX_LONGITUDE) return {};
  if (lat === 0 && lon === 0) return {};
  const alt = finiteNumber(tags.GPSAltitude);
  return {
    gpsLat: lat,
    gpsLon: lon,
    ...(alt !== undefined ? { gpsAlt: alt } : {}),
  };
};

const withoutUndefined = <T extends object>(object: T): T =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined)
  ) as T;

/** ExifTool のタグから、日付と、日付以外の項目を取り出す。`isVideo`: 動画かどうか(スキャンの種類で決める) */
export const extractMetadata = (
  tags: Tags,
  isVideo: boolean
): ExtractedMetadata => {
  const width = nonNegative(tags.ImageWidth);
  const height = nonNegative(tags.ImageHeight);
  const details: MediaDetails = withoutUndefined({
    cameraMake: textOf(tags.Make),
    cameraModel: textOf(tags.Model),
    lensModel: textOf(tags.LensModel) ?? textOf(tags.Lens),
    width: width === undefined ? undefined : Math.trunc(width),
    height: height === undefined ? undefined : Math.trunc(height),
    durationSec: nonNegative(tags.Duration),
    ...readGps(tags),
  });
  const warning = textOf(tags.Warning);
  return {
    dates: isVideo ? readVideoDates(tags) : readPhotoDates(tags),
    details,
    ...(warning ? { warning } : {}),
  };
};
