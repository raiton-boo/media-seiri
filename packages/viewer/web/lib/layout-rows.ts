export type RowItem = { ratio: number };
export type Row = { start: number; end: number; height: number };

/**
 * 行ぞろえの配置: 目標の高さで、幅いっぱいに並べ、はみ出す手前で改行して、行の高さを縮める(各行の幅が、ちょうど `width` になる)。
 * 最後の行は、埋まらなければ、目標の高さのまま(引き伸ばすと、1 枚だけ巨大になるため)。
 */
export const layoutRows = (
  items: readonly RowItem[],
  width: number,
  targetHeight: number,
  gap: number
): Row[] => {
  if (width <= 0 || items.length === 0) return [];
  const rows: Row[] = [];
  let start = 0;
  let ratioSum = 0;
  for (let index = 0; index < items.length; index += 1) {
    ratioSum += items[index]?.ratio ?? 1;
    const count = index - start + 1;
    const rowWidth = ratioSum * targetHeight + gap * (count - 1);
    if (rowWidth >= width) {
      rows.push({
        start,
        end: index + 1,
        height: (width - gap * (count - 1)) / ratioSum,
      });
      start = index + 1;
      ratioSum = 0;
    }
  }
  if (start < items.length)
    rows.push({ start, end: items.length, height: targetHeight });
  return rows;
};
