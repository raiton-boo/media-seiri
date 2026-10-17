import type { DateParts, DateResolution } from '../date/index.ts';
import { avoidReservedName, cleanOriginalName } from './clean-name.ts';
import { extensionOf, stemOf } from './files.ts';

/** 置き場所の区分(台帳の `library_files.bucket`) */
export type Bucket =
  | 'full'
  | 'time_unknown'
  | 'date_unknown'
  | 'md_unknown'
  | 'unknown_none'
  | 'unknown_invalid'
  | 'unknown_repaired_nodate'
  | 'unknown_unreadable';

/** `_unknown/` に入れる理由 */
export type UnknownReason =
  | 'none'
  | 'invalid'
  | 'repaired-nodate'
  | 'unreadable';

/** 置き場所を決めるための、日付の状態 */
export type PlacementTarget =
  | {
      kind: 'dated';
      precision: 'full' | 'date' | 'month' | 'year';
      parts: DateParts;
    }
  | { kind: 'unknown'; reason: UnknownReason };

/** 置き場所とファイル名 */
export type Placement = {
  bucket: Bucket;
  /** ライブラリの根からの、フォルダ(`/` 区切り) */
  directory: string;
  fileName: string;
};

const UNKNOWN_ROOT = '_unknown';
const UNKNOWN_FOLDERS: Record<
  UnknownReason,
  { bucket: Bucket; folder: string }
> = {
  none: { bucket: 'unknown_none', folder: '日付なし' },
  invalid: { bucket: 'unknown_invalid', folder: '日付が不正' },
  'repaired-nodate': {
    bucket: 'unknown_repaired_nodate',
    folder: '修復後も日付なし',
  },
  unreadable: { bucket: 'unknown_unreadable', folder: '読み取り不可' },
};
const TIME_UNKNOWN_FOLDER = '_時刻不明';
const DATE_UNKNOWN_FOLDER = '_日付不明';
const MONTH_DAY_UNKNOWN_FOLDER = '_月日不明';
const YEAR_DIGITS = 4;
const TWO_DIGITS = 2;

const pad = (value: number, length: number): string =>
  String(value).padStart(length, '0');

/** 日付の決定の結果から、置き場所を決めるための状態を作る。日付なし・無効は、`_unknown/` へ */
export const targetFromResolution = (
  resolution: DateResolution
): PlacementTarget => {
  const { precision, parts } = resolution;
  if (precision === 'none') return { kind: 'unknown', reason: 'none' };
  if (precision === 'invalid' || parts === undefined)
    return { kind: 'unknown', reason: 'invalid' };
  return { kind: 'dated', precision, parts };
};

const requirePart = (value: number | undefined, name: string): number => {
  if (value === undefined) throw new Error(`日付の部品が足りない: ${name}`);
  return value;
};

/** 精度ごとの、日付の部分(ファイル名の頭)と、置き場所のフォルダ、区分 */
const datedPlacement = (
  target: Extract<PlacementTarget, { kind: 'dated' }>
) => {
  const { parts, precision } = target;
  const year = pad(parts.year, YEAR_DIGITS);
  if (precision === 'year') {
    return {
      bucket: 'md_unknown' as const,
      directory: `${year}/${MONTH_DAY_UNKNOWN_FOLDER}`,
      datePart: year,
    };
  }
  const month = pad(requirePart(parts.month, 'month'), TWO_DIGITS);
  if (precision === 'month') {
    return {
      bucket: 'date_unknown' as const,
      directory: `${year}/${month}/${DATE_UNKNOWN_FOLDER}`,
      datePart: `${year}.${month}`,
    };
  }
  const day = pad(requirePart(parts.day, 'day'), TWO_DIGITS);
  if (precision === 'date') {
    return {
      bucket: 'time_unknown' as const,
      directory: `${year}/${month}/${TIME_UNKNOWN_FOLDER}`,
      datePart: `${year}.${month}.${day}`,
    };
  }
  const hour = pad(requirePart(parts.hour, 'hour'), TWO_DIGITS);
  const minute = pad(requirePart(parts.minute, 'minute'), TWO_DIGITS);
  const second = pad(requirePart(parts.second, 'second'), TWO_DIGITS);
  return {
    bucket: 'full' as const,
    directory: `${year}/${month}`,
    datePart: `${year}.${month}.${day}_${hour}-${minute}-${second}`,
  };
};

/**
 * 置き場所とファイル名を決める(仕様書 §2-2)。
 * 名前は、`<日付の部分>_<元の名前>.<拡張子>`。日付が取れなかったものは、元の名前だけ。
 * @param originalFileName 元のファイル名(拡張子つき。ZIP 内のものは、ZIP 内でのファイル名)
 * @param sequence 名前が衝突したときの連番(1 から。2 桁で、100 以上は桁を増やす)
 */
export const buildPlacement = (
  target: PlacementTarget,
  originalFileName: string,
  sequence?: number
): Placement => {
  const originalPart = cleanOriginalName(stemOf(originalFileName));
  const extension = extensionOf(originalFileName);
  const suffix = sequence === undefined ? '' : `_${pad(sequence, TWO_DIGITS)}`;
  const extensionPart = extension === '' ? '' : `.${extension}`;

  if (target.kind === 'unknown') {
    const { bucket, folder } = UNKNOWN_FOLDERS[target.reason];
    return {
      bucket,
      directory: `${UNKNOWN_ROOT}/${folder}`,
      fileName: avoidReservedName(`${originalPart}${suffix}${extensionPart}`),
    };
  }
  const { bucket, directory, datePart } = datedPlacement(target);
  return {
    bucket,
    directory,
    fileName: `${datePart}_${originalPart}${suffix}${extensionPart}`,
  };
};
