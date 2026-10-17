import { extensionOf } from '@file-seiri/core';

/** Takeout の json の、補足のメタデータの名前(新しい形式) */
const SUPPLEMENTAL = 'supplemental-metadata';
const EDITED_SUFFIX = '-edited';
/** `IMG_1234(1).jpg` の、重複の番号 */
const DUPLICATE_NUMBER = /^(.*)\((\d+)\)$/;

/**
 * 写真に対応する、Takeout の json の名前の候補(優先順)。`docs/features/zip-handling.md` §8。
 * - `IMG_1234.jpg` → `IMG_1234.jpg.json`、`IMG_1234.jpg.supplemental-metadata.json`
 * - `IMG_1234(1).jpg` → `IMG_1234.jpg(1).json`
 * - 編集済み `IMG_1234-edited.jpg` → 元の `IMG_1234.jpg.json`
 */
export const takeoutJsonCandidates = (fileName: string): string[] => {
  const extension = extensionOf(fileName);
  const dotExtension =
    extension === '' ? '' : fileName.slice(-(extension.length + 1));
  let stem =
    extension === '' ? fileName : fileName.slice(0, -(extension.length + 1));

  if (stem.toLowerCase().endsWith(EDITED_SUFFIX)) {
    stem = stem.slice(0, -EDITED_SUFFIX.length);
  }
  const duplicate = DUPLICATE_NUMBER.exec(stem);
  const baseName = `${duplicate ? duplicate[1] : stem}${dotExtension}`;
  const number = duplicate ? `(${duplicate[2]})` : '';

  return [
    `${baseName}${number}.json`,
    `${baseName}.${SUPPLEMENTAL}${number}.json`,
  ];
};

/**
 * 同じフォルダのファイル名の中から、対応する json を探す。
 * `siblingNames` は、同じフォルダにあるファイル名(スキャンの結果から作る)。見つからなければ undefined。
 * 大文字小文字は、区別しない。
 */
export const findTakeoutJson = (
  fileName: string,
  siblingNames: Iterable<string>
): string | undefined => {
  const lowerToActual = new Map<string, string>();
  for (const name of siblingNames) lowerToActual.set(name.toLowerCase(), name);
  for (const candidate of takeoutJsonCandidates(fileName)) {
    const found = lowerToActual.get(candidate.toLowerCase());
    if (found) return found;
  }
  return undefined;
};

/** Takeout の json から取った、日付と位置 */
export type TakeoutMetadata = {
  /** `photoTakenTime`(UTC のエポック秒) */
  photoTakenEpochSeconds?: number;
  gpsLat?: number;
  gpsLon?: number;
  gpsAlt?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * Takeout の json を読む。`photoTakenTime.timestamp` は、文字列のエポック秒。
 * 位置は `geoData`。Takeout は、位置がないとき、緯度・経度を 0 にするため、どちらも 0 のときは、ないものとする。
 * JSON として読めない・形が違う場合は、空の結果(json がなくても、取り込みは続けられる)。
 */
export const parseTakeoutJson = (text: string): TakeoutMetadata => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};
  const result: TakeoutMetadata = {};

  const taken = isRecord(raw.photoTakenTime)
    ? raw.photoTakenTime.timestamp
    : undefined;
  const seconds = typeof taken === 'string' ? Number(taken) : taken;
  if (typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0) {
    result.photoTakenEpochSeconds = seconds;
  }

  const geo = isRecord(raw.geoData) ? raw.geoData : undefined;
  const lat = geo?.latitude;
  const lon = geo?.longitude;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Math.abs(lat) <= MAX_LATITUDE &&
    Math.abs(lon) <= MAX_LONGITUDE &&
    !(lat === 0 && lon === 0)
  ) {
    result.gpsLat = lat;
    result.gpsLon = lon;
    if (typeof geo?.altitude === 'number' && Number.isFinite(geo.altitude)) {
      result.gpsAlt = geo.altitude;
    }
  }
  return result;
};
