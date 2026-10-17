import type { MediaKind } from '@file-seiri/ledger';

/** SSD のソースを読むときに、同時に動かす数 */
const SSD_READ_CONCURRENCY = 4;

/**
 * ソースを読む解析(メタデータ・ハッシュ)を、同時に動かす数(仕様書 §17-3)。
 * HDD は、並列の読み出しで、ヘッドが行き来して遅くなるため、順番に読む。SSD は、並列にする。
 * USB でつながったものは、HDD か USB メモリかを見分けられないため、安全なほう(順番)にする。
 */
export const readConcurrency = (mediaKind: MediaKind | undefined): number =>
  mediaKind === 'ssd' ? SSD_READ_CONCURRENCY : 1;

/**
 * 項目を、同時に `limit` 件までの並行で処理する。結果は、元の並びで返す。
 * 1 件でも拒否されたら、新しい項目は始めず、最初の拒否を投げる(動いている分は、終わるのを待つ)。
 */
export const mapConcurrent = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | undefined;

  const worker = async (): Promise<void> => {
    while (!failure) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await work(items[index] as T, index);
      } catch (error) {
        failure ??= { error };
        return;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  if (failure) throw failure.error;
  return results;
};
