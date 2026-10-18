import { CliError } from '../cli-error.ts';

/**
 * `--sample` の割合を読む。`0.1`(割合)か `10%`(百分率)。0 より大きく、1(100%)以下。
 * それ以外(`0`・`150%`・`1.5`・文字)は、エラー。
 */
export const parseSampleRatio = (text: string): number => {
  const trimmed = text.trim();
  const isPercent = trimmed.endsWith('%');
  const number = Number(isPercent ? trimmed.slice(0, -1) : trimmed);
  const ratio = isPercent ? number / 100 : number;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new CliError(
      `--sample の割合が正しくありません: ${text}(0 より大きく 1 以下の割合、または 1%〜100% で指定してください。例: 0.1、10%)`
    );
  }
  return ratio;
};

/**
 * 項目から、割合に応じた数(切り上げ。最低 1 件)を、無作為に選ぶ。元の並びのまま返す(ディスクを、順番に読めるように)。
 * `random` は、0 以上 1 未満の乱数(テストで差し替える)。
 */
export const pickSample = <T>(
  items: readonly T[],
  ratio: number,
  random: () => number
): T[] => {
  if (ratio >= 1 || items.length === 0) return [...items];
  const count = Math.max(1, Math.ceil(items.length * ratio));
  // 部分的な Fisher-Yates で、先頭の count 個の添字を選ぶ
  const indexes = items.map((_, index) => index);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (indexes.length - i));
    [indexes[i], indexes[j]] = [indexes[j] as number, indexes[i] as number];
  }
  return indexes
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => items[index] as T);
};
