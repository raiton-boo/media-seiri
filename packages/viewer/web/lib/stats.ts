/** 統計のグラフの、決まり(棒の高さ・割合) */

/** 棒の高さ(px)。最大が `maxPx`。0 は 0。1 以上は、見えるよう、最小 `minPx` */
export const barHeight = (
  count: number,
  max: number,
  maxPx: number,
  minPx = 6
): number =>
  count <= 0 || max <= 0
    ? 0
    : Math.max(minPx, Math.round((count / max) * maxPx));

/** 積み上げ棒の、段ごとの高さ(px)。合計の棒の高さを、件数の比で割る(段が 0 なら 0。端数は、最後の段で合わせる) */
export const stackHeights = (
  parts: readonly number[],
  max: number,
  maxPx: number
): number[] => {
  const total = parts.reduce((sum, part) => sum + part, 0);
  const whole = barHeight(total, max, maxPx);
  if (total === 0) return parts.map(() => 0);
  const heights = parts.map((part) => Math.floor((part / total) * whole));
  // 切り捨ての端数は、いちばん大きい段へ(合計が、棒の高さに合う)
  const rest = whole - heights.reduce((sum, h) => sum + h, 0);
  const largest = parts.indexOf(Math.max(...parts));
  heights[largest] = (heights[largest] ?? 0) + rest;
  return heights;
};

/** 横棒の幅(%)。最大が 100 */
export const barPercent = (count: number, max: number): number =>
  count <= 0 || max <= 0 ? 0 : Math.max(2, Math.round((count / max) * 100));

/** 期間の表示(`2014.12`〜`2024.08`)。精度が、年だけなら、年だけ */
export const periodLabel = (takenAt: string): string => {
  const [year, month] = takenAt.split(/[-T]/);
  return month ? `${year}.${month}` : (year ?? takenAt);
};
