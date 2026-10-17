/**
 * ファイルの更新日を、台帳に持つ形(ミリ秒の整数)にする。
 *
 * `fs.stat` の `mtimeMs` は、小数のミリ秒で返ることがある。保存と、ハッシュキャッシュの照合で
 * 丸め方がずれると、同じファイルなのにキャッシュが当たらないため、切り捨てる丸めをここに 1 つだけ置く。
 * 1970 年より前の値は、負の方向へ切り捨てる(`Math.floor`)。
 */
export const toMtimeMs = (mtimeMs: number): number => {
  if (!Number.isFinite(mtimeMs)) {
    throw new RangeError(`更新日が数ではありません: ${mtimeMs}`);
  }
  return Math.floor(mtimeMs);
};
