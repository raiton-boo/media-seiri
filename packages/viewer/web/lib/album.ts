/** アルバムの机で使う、日付・写真の比率・傾きの、決まり */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export type TakenAtParts = {
  year: number;
  month: number;
  day: number;
  /** 時刻のない日付(精度 `date`)では、undefined */
  hour: number | undefined;
  minute: number | undefined;
};

/** `YYYY-MM-DDTHH:mm:ss` または `YYYY-MM-DD`(`formatTakenAt` の形式)を、部品にする。読めなければ undefined */
export const parseTakenAt = (takenAt: string): TakenAtParts | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(takenAt);
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: match[4] === undefined ? undefined : Number(match[4]),
    minute: match[5] === undefined ? undefined : Number(match[5]),
  };
};

export const weekdayOf = (year: number, month: number, day: number): string =>
  WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';

/** 時間帯: 12 時前=午前、18 時前=午後、それ以降=夜 */
export const timeBand = (hour: number): string =>
  hour < 12 ? '午前' : hour < 18 ? '午後' : '夜';

/** できごとの札(`4/6(日)午後`)。時刻のない日付は、時間帯を付けない */
export const eventLabel = (startAt: string): string => {
  const parts = parseTakenAt(startAt);
  if (!parts) return startAt;
  const band = parts.hour === undefined ? '' : timeBand(parts.hour);
  return `${parts.month}/${parts.day}(${weekdayOf(parts.year, parts.month, parts.day)})${band}`;
};

/** できごとの題(`2014年4月6日(日)午後`) */
export const eventTitle = (startAt: string): string => {
  const parts = parseTakenAt(startAt);
  if (!parts) return startAt;
  const band = parts.hour === undefined ? '' : timeBand(parts.hour);
  return `${parts.year}年${parts.month}月${parts.day}日(${weekdayOf(parts.year, parts.month, parts.day)})${band}`;
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** 時刻(`15:32`)。時刻がなければ、空 */
export const clockOf = (takenAt: string | null): string => {
  const parts = takenAt ? parseTakenAt(takenAt) : undefined;
  return parts && parts.hour !== undefined && parts.minute !== undefined
    ? `${pad(parts.hour)}:${pad(parts.minute)}`
    : '';
};

/**
 * 机のポラロイドの枠の比率(`neo.css` の `r43`・`r34`・`r11`・`r32`)を、写真の縦横から選ぶ。
 * 縦横が分からなければ、4:3。
 */
export const aspectClass = (
  width: number | null,
  height: number | null
): 'r43' | 'r34' | 'r11' | 'r32' => {
  if (!width || !height) return 'r43';
  const ratio = width / height;
  if (ratio >= 1.4) return 'r32';
  if (ratio >= 1.15) return 'r43';
  if (ratio >= 0.95) return 'r11';
  return 'r34';
};

const ROTATIONS = [-2, 1.5, -1, 2, -1.5, 1, 2, -2, 1.5, -1, 2, -1.5] as const;

/** 机での傾き(度)。位置の番号から決める(毎回同じ。±3° 以内。design.md) */
export const rotationOf = (index: number): number =>
  ROTATIONS[
    ((index % ROTATIONS.length) + ROTATIONS.length) % ROTATIONS.length
  ] ?? 0;

/** 付箋の色(design.md §2 の、意味のある色を、順に使う) */
const STICKERS = [
  'var(--y)',
  'var(--p)',
  'var(--b)',
  'var(--g)',
  'var(--o)',
  'var(--l)',
] as const;

export const stickerColor = (index: number): string =>
  STICKERS[((index % STICKERS.length) + STICKERS.length) % STICKERS.length] ??
  'var(--y)';

/** 動画の長さ(`0:23`) */
export const formatClip = (seconds: number): string => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
};
