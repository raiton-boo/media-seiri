import { epochToLocalParts } from './timezone.ts';
import type { DateOptions, DateParts } from './types.ts';
import { isExistingDate } from './validate.ts';

/** ファイル名から読んだ日付 */
export type FilenameDate =
  | { kind: 'found'; parts: DateParts; pattern: string }
  // 日付の形をしているが、存在しない日付(IMG_20240230 など)
  | { kind: 'invalid'; pattern: string }
  | { kind: 'none' };

// 13 桁のエポックミリ秒は、2000-01-01 から現在までの範囲に収まる場合だけ、日付とみなす(範囲外は、ただの番号)
const EPOCH_MILLIS_MIN = Date.UTC(2000, 0, 1);
const EPOCH_MILLIS_DIGITS = 13;
// 年が 2 桁の形は、2000 年代として読む
const TWO_DIGIT_YEAR_BASE = 2000;

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
const DATE_PATTERN = new RegExp(
  `(?<!\\d)${YEAR}${DATE_SEPARATOR}(\\d{2})${DATE_SEPARATOR}(\\d{2})(?!\\d)`
);
// 年月だけは、6 桁の連番と区別するため、区切り文字を必須にする
const MONTH_PATTERN = new RegExp(`(?<!\\d)${YEAR}[-_.](\\d{2})(?!\\d)`);
const EPOCH_PATTERN = new RegExp(
  `(?<!\\d)(\\d{${EPOCH_MILLIS_DIGITS}})(?!\\d)`
);

const numbersOf = (match: RegExpMatchArray): number[] =>
  match.slice(1).map(Number);

const asFound = (parts: DateParts, pattern: string): FilenameDate =>
  isExistingDate(parts)
    ? { kind: 'found', parts, pattern }
    : { kind: 'invalid', pattern };

/**
 * ファイル名に含まれる日付を読み取る(`date-resolution.md` §4)。
 * 1970 年より前・未来かどうかの判定は、ここでは行わない(日付の決定の側で行う)。
 */
export const parseFilenameDate = (
  fileName: string,
  options: DateOptions
): FilenameDate => {
  const epochMatch = fileName.match(EPOCH_PATTERN);
  if (epochMatch?.[1]) {
    const millis = Number(epochMatch[1]);
    if (millis >= EPOCH_MILLIS_MIN && millis <= options.now.getTime()) {
      return {
        kind: 'found',
        pattern: 'epoch-millis',
        parts: epochToLocalParts(millis, options.timeZone),
      };
    }
  }

  const fullMatch = fileName.match(FULL_PATTERN);
  if (fullMatch) {
    const [year, month, day, hour, minute, second] = numbersOf(fullMatch);
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
    return asFound({ year, month, day, hour, minute, second }, 'date-time');
  }

  const twoDigitMatch = fileName.match(TWO_DIGIT_YEAR_PATTERN);
  if (twoDigitMatch) {
    const [shortYear, month, day, hour, minute, second] =
      numbersOf(twoDigitMatch);
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
    return asFound(
      {
        year: TWO_DIGIT_YEAR_BASE + shortYear,
        month,
        day,
        hour,
        minute,
        second,
      },
      'two-digit-year'
    );
  }

  const dateMatch = fileName.match(DATE_PATTERN);
  if (dateMatch) {
    const [year, month, day] = numbersOf(dateMatch);
    if (year === undefined || month === undefined || day === undefined)
      return { kind: 'none' };
    return asFound({ year, month, day }, 'date-only');
  }

  const monthMatch = fileName.match(MONTH_PATTERN);
  if (monthMatch) {
    const [year, month] = numbersOf(monthMatch);
    if (year === undefined || month === undefined) return { kind: 'none' };
    return asFound({ year, month }, 'year-month');
  }

  return { kind: 'none' };
};
