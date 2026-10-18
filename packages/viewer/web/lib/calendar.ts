/** カレンダーの、決まり(濃さ・月の並び) */
import { weekdayOf } from './album';

/** 濃さ(0 = 写真なし、1〜4 = 少ない〜多い)。その年でいちばん多い日を基準に、4 等分する */
export const levelOf = (count: number, max: number): 0 | 1 | 2 | 3 | 4 => {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
};

export type CalendarCell =
  /** 月の最初の曜日までの、空きのマス */
  | { kind: 'blank' }
  | { kind: 'day'; day: number; date: string; count: number; level: number };

const pad = (value: number): string => String(value).padStart(2, '0');

/** 1 か月ぶんのマス(日曜はじまり。最初の曜日までの空きを、先に並べる) */
export const monthCells = (
  year: number,
  month: number,
  counts: ReadonlyMap<string, number>,
  max: number
): CalendarCell[] => {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: CalendarCell[] = Array.from({ length: first }, () => ({
    kind: 'blank' as const,
  }));
  for (let day = 1; day <= length; day += 1) {
    const date = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
    const count = counts.get(date) ?? 0;
    cells.push({ kind: 'day', day, date, count, level: levelOf(count, max) });
  }
  return cells;
};

/** その年で、枚数の多い日(多い順。同じ枚数なら、新しい日が先)。`limit` 件 */
export const topDays = (
  days: readonly { date: string; count: number }[],
  limit: number
): { date: string; count: number }[] =>
  [...days]
    .sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1))
    .slice(0, limit);

/** `4/26(土)` */
export const shortDay = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return `${month}/${day}(${weekdayOf(year, month, day)})`;
};

/** `2014年4月6日(日)` */
export const longDay = (date: string): string => {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return `${year}年${month}月${day}日(${weekdayOf(year, month, day)})`;
};
