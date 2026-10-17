/** 日付の精度(仕様書 §2-2 の表と同じ区分) */
export type DatePrecision =
  | 'full'
  | 'date'
  | 'month'
  | 'year'
  | 'none'
  | 'invalid';

/** 日付の取得元。mtime は、書き換わっていて信頼できないため、取得元に含めない */
export type DateSource = 'metadata' | 'filename' | 'none';

export type DateParts = {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
};

/** ファイル本体のメタデータから読んだ日付 */
export type MetadataDate =
  | { kind: 'found'; precision: 'full' | 'date'; parts: DateParts }
  | { kind: 'invalid' }
  | { kind: 'none' };

/** ファイル名から読んだ日付 */
export type FilenameDate =
  | {
      kind: 'found';
      precision: 'full' | 'date' | 'month';
      parts: DateParts;
      pattern: string;
    }
  | { kind: 'invalid'; pattern: string }
  | { kind: 'none' };

export type Resolution = {
  source: DateSource;
  precision: DatePrecision;
  parts?: DateParts;
  pattern?: string;
};

// 13 桁のエポックミリ秒は、この範囲に収まる場合だけ日付とみなす(範囲外は、ただの番号)
const EPOCH_MILLIS_MIN = Date.UTC(2000, 0, 1);
const EPOCH_MILLIS_DIGITS = 13;

const MAX_MONTH = 12;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;

// 年は 1900 年代と 2000 年代だけ。連番(IMG_1234 など)を日付と誤認しないため
const YEAR = '((?:19|20)\\d{2})';
const DATE_SEPARATOR = '[-_. ]?';
const TIME_SEPARATOR = '[-_.:]?';
// 末尾のミリ秒(最大 3 桁)は無視する
const MILLIS_SUFFIX = '(?:[-_.]?\\d{1,3})?';

const FULL_PATTERN = new RegExp(
  `(?<!\\d)${YEAR}${DATE_SEPARATOR}(\\d{2})${DATE_SEPARATOR}(\\d{2})[-_. T]?(\\d{2})${TIME_SEPARATOR}(\\d{2})${TIME_SEPARATOR}(\\d{2})${MILLIS_SUFFIX}(?!\\d)`
);
// 年が 2 桁の形(例: 15-09-06-15-48-35-995_photo.jpg = 2015-09-06 15:48:35)。実データで多かった形。
// 連番との誤認を避けるため、区切りが「-」で、時分秒とミリ秒(3 桁)まで揃っている場合だけ読む
const TWO_DIGIT_YEAR_PATTERN =
  /(?<!\d)(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})(?!\d)/;
const TWO_DIGIT_YEAR_BASE = 2000;
const DATE_PATTERN = new RegExp(
  `(?<!\\d)${YEAR}${DATE_SEPARATOR}(\\d{2})${DATE_SEPARATOR}(\\d{2})(?!\\d)`
);
// 年月だけは、6 桁の連番と区別するため、区切り文字を必須にする
const MONTH_PATTERN = new RegExp(`(?<!\\d)${YEAR}[-_.](\\d{2})(?!\\d)`);
const EPOCH_PATTERN = new RegExp(
  `(?<!\\d)(\\d{${EPOCH_MILLIS_DIGITS}})(?!\\d)`
);

const daysInMonth = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

/** 存在する日付・時刻か(2 月 30 日や 25 時を除く) */
export const isValidParts = (parts: DateParts): boolean => {
  const { year, month, day, hour, minute, second } = parts;
  if (month !== undefined && (month < 1 || month > MAX_MONTH)) return false;
  if (month !== undefined && day !== undefined) {
    if (day < 1 || day > daysInMonth(year, month)) return false;
  }
  if (hour !== undefined && (hour < 0 || hour > MAX_HOUR)) return false;
  if (minute !== undefined && (minute < 0 || minute > MAX_MINUTE)) return false;
  if (second !== undefined && (second < 0 || second > MAX_SECOND)) return false;
  return true;
};

const toNumbers = (match: RegExpMatchArray): number[] =>
  match.slice(1).map(Number);

/**
 * ファイル名に含まれる日付を読み取る。
 * 日付の形をしているのに存在しない日付のとき(IMG_20240230 など)は、invalid を返す。
 */
export const parseFilenameDate = (
  fileName: string,
  now: Date = new Date()
): FilenameDate => {
  const epochMatch = fileName.match(EPOCH_PATTERN);
  if (epochMatch?.[1]) {
    const millis = Number(epochMatch[1]);
    if (millis >= EPOCH_MILLIS_MIN && millis <= now.getTime()) {
      const date = new Date(millis);
      return {
        kind: 'found',
        precision: 'full',
        pattern: 'epoch-millis',
        parts: {
          year: date.getFullYear(),
          month: date.getMonth() + 1,
          day: date.getDate(),
          hour: date.getHours(),
          minute: date.getMinutes(),
          second: date.getSeconds(),
        },
      };
    }
  }

  const fullMatch = fileName.match(FULL_PATTERN);
  if (fullMatch) {
    const [year, month, day, hour, minute, second] = toNumbers(fullMatch);
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined
    ) {
      return { kind: 'none' };
    }
    const parts = { year, month, day, hour, minute, second };
    return isValidParts(parts)
      ? { kind: 'found', precision: 'full', parts, pattern: 'date-time' }
      : { kind: 'invalid', pattern: 'date-time' };
  }

  const twoDigitYearMatch = fileName.match(TWO_DIGIT_YEAR_PATTERN);
  if (twoDigitYearMatch) {
    const [shortYear, month, day, hour, minute, second] =
      toNumbers(twoDigitYearMatch);
    if (
      shortYear === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined
    ) {
      return { kind: 'none' };
    }
    const parts = {
      year: TWO_DIGIT_YEAR_BASE + shortYear,
      month,
      day,
      hour,
      minute,
      second,
    };
    return isValidParts(parts)
      ? { kind: 'found', precision: 'full', parts, pattern: 'two-digit-year' }
      : { kind: 'invalid', pattern: 'two-digit-year' };
  }

  const dateMatch = fileName.match(DATE_PATTERN);
  if (dateMatch) {
    const [year, month, day] = toNumbers(dateMatch);
    if (year === undefined || month === undefined || day === undefined)
      return { kind: 'none' };
    const parts = { year, month, day };
    return isValidParts(parts)
      ? { kind: 'found', precision: 'date', parts, pattern: 'date-only' }
      : { kind: 'invalid', pattern: 'date-only' };
  }

  const monthMatch = fileName.match(MONTH_PATTERN);
  if (monthMatch) {
    const [year, month] = toNumbers(monthMatch);
    if (year === undefined || month === undefined) return { kind: 'none' };
    const parts = { year, month };
    return isValidParts(parts)
      ? { kind: 'found', precision: 'month', parts, pattern: 'year-month' }
      : { kind: 'invalid', pattern: 'year-month' };
  }

  return { kind: 'none' };
};

/**
 * 日付を決める(仕様書 §3 の優先順位)。
 * 1. 本体のメタデータ  2. ファイル名(フォールバック)  3. どちらもなければ none / invalid
 * mtime は採用しない。
 */
export const resolveDate = (
  metadata: MetadataDate,
  fileName: string,
  now: Date = new Date()
): Resolution => {
  if (metadata.kind === 'found') {
    return {
      source: 'metadata',
      precision: metadata.precision,
      parts: metadata.parts,
    };
  }
  const fromName = parseFilenameDate(fileName, now);
  if (fromName.kind === 'found') {
    return {
      source: 'filename',
      precision: fromName.precision,
      parts: fromName.parts,
      pattern: fromName.pattern,
    };
  }
  if (metadata.kind === 'invalid' || fromName.kind === 'invalid') {
    return { source: 'none', precision: 'invalid' };
  }
  return { source: 'none', precision: 'none' };
};
