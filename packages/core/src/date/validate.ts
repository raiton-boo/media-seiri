import { epochToLocalParts } from './timezone.ts';
import type { DateOptions, DateParts, DatePrecision } from './types.ts';

const MIN_YEAR = 1970;
const MAX_MONTH = 12;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** 存在する日付・時刻か(13 月、2 月 30 日、25 時などを除く)。欠けている部品は、検査しない */
export const isExistingDate = (parts: DateParts): boolean => {
  const { year, month, day, hour, minute, second } = parts;
  if (!Number.isInteger(year)) return false;
  if (month !== undefined && (month < 1 || month > MAX_MONTH)) return false;
  if (
    month !== undefined &&
    day !== undefined &&
    (day < 1 || day > daysInMonth(year, month))
  )
    return false;
  if (hour !== undefined && (hour < 0 || hour > MAX_HOUR)) return false;
  if (minute !== undefined && (minute < 0 || minute > MAX_MINUTE)) return false;
  if (second !== undefined && (second < 0 || second > MAX_SECOND)) return false;
  return true;
};

/** 日時の部品から、精度を決める(時刻は、時・分・秒がそろっているときだけ) */
export const precisionOf = (
  parts: DateParts
): Exclude<DatePrecision, 'none' | 'invalid'> => {
  const { month, day, hour, minute, second } = parts;
  if (month === undefined) return 'year';
  if (day === undefined) return 'month';
  if (hour === undefined || minute === undefined || second === undefined)
    return 'date';
  return 'full';
};

/** 精度に応じた部品を、順に並べる(未来かどうかの比較に使う) */
const comparableParts = (
  parts: DateParts,
  precision: ReturnType<typeof precisionOf>
): number[] => {
  const all = [
    parts.year,
    parts.month ?? 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  ];
  const lengths = { year: 1, month: 2, date: 3, full: 6 } as const;
  return all.slice(0, lengths[precision]);
};

const isLaterThan = (target: number[], reference: number[]): boolean => {
  for (const [index, value] of target.entries()) {
    const other = reference[index] ?? 0;
    if (value !== other) return value > other;
  }
  return false;
};

/**
 * 日時の部品が有効なら、その精度を返す。無効なら undefined(仕様書 §3-3)。
 * 無効: 存在しない日付、1970 年より前、実行時点より未来。
 */
export const validatedPrecision = (
  parts: DateParts,
  options: DateOptions
): ReturnType<typeof precisionOf> | undefined => {
  if (!isExistingDate(parts) || parts.year < MIN_YEAR) return undefined;
  const precision = precisionOf(parts);
  const nowParts = epochToLocalParts(options.now.getTime(), options.timeZone);
  if (
    isLaterThan(
      comparableParts(parts, precision),
      comparableParts(nowParts, precision)
    )
  )
    return undefined;
  return precision;
};

/** `taken_at`(台帳)に保存する文字列。精度までの、ローカル時刻 */
export const formatTakenAt = (parts: DateParts): string => {
  const pad = (value: number, length = 2): string =>
    String(value).padStart(length, '0');
  const { year, month, day, hour, minute, second } = parts;
  let text = pad(year, 4);
  if (month !== undefined) text += `-${pad(month)}`;
  if (month !== undefined && day !== undefined) text += `-${pad(day)}`;
  if (hour !== undefined && minute !== undefined && second !== undefined) {
    text += `T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  }
  return text;
};
