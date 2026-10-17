import type { DateParts } from './types.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  // hourCycle を h23 にして、0 時を「24」と表示する環境の違いを避ける
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
};

/** UNIX のミリ秒を、指定のタイムゾーンの日時の部品にする */
export const epochToLocalParts = (
  epochMilliseconds: number,
  timeZone: string
): DateParts => {
  const values = new Map<string, number>();
  for (const part of formatterFor(timeZone).formatToParts(
    new Date(epochMilliseconds)
  )) {
    values.set(part.type, Number(part.value));
  }
  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
};

/** UTC の日時の部品を、指定のタイムゾーンの日時の部品に変換する(動画の CreateDate 用) */
export const utcPartsToLocalParts = (
  parts: DateParts,
  timeZone: string
): DateParts => {
  const { year, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts;
  return epochToLocalParts(
    Date.UTC(year, month - 1, day, hour, minute, second),
    timeZone
  );
};

/** この環境のタイムゾーン(IANA の名前) */
export const systemTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
