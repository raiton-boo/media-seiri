/** 全角の文字(日本語など)の範囲。表示の幅が 2 */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u;

/** 端末での、表示の幅(全角は 2、半角は 1) */
export const displayWidth = (text: string): number => {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
};

export const padEndDisplay = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - displayWidth(text)));

/** 表(ヘッダーつき)を、列の幅をそろえた行にする。最後の列は、そろえない */
export const formatTable = (
  header: readonly string[],
  rows: readonly (readonly string[])[]
): string[] => {
  const widths = header.map((title, column) =>
    Math.max(
      displayWidth(title),
      ...rows.map((row) => displayWidth(row[column] ?? ''))
    )
  );
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        column === cells.length - 1
          ? cell
          : padEndDisplay(cell, (widths[column] ?? 0) + 2)
      )
      .join('')
      .trimEnd();
  return [render(header), ...rows.map(render)];
};
