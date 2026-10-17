import type { Database } from 'bun:sqlite';
import { toMtimeMs } from '@file-seiri/core';
import { formatTimestamp } from './time.ts';

/** キャッシュのキー(`er.md` §5)。`mtimeMs` は、小数のミリ秒でもよい(保存と照合で、同じ丸め方にする) */
export type HashCacheKey = {
  volumeId: number;
  relPath: string;
  sizeBytes: number;
  mtimeMs: number;
};

/** キャッシュにある内容の ID。キーが 1 つでも違えば(サイズ・更新日が変わっていれば)、undefined */
export const findCachedContentId = (
  db: Database,
  key: HashCacheKey
): number | undefined =>
  db
    .query<{ contentId: number }, [number, string, number, number]>(
      `SELECT content_id AS contentId FROM hash_cache
       WHERE volume_id = ? AND rel_path = ? AND size_bytes = ? AND mtime_ms = ?`
    )
    .get(key.volumeId, key.relPath, key.sizeBytes, toMtimeMs(key.mtimeMs))
    ?.contentId;

/** キャッシュに保存する。同じキーがあれば、内容と計算した時刻を上書きする */
export const putHashCache = (
  db: Database,
  key: HashCacheKey,
  entry: { contentId: number; computedAt: Date }
): void => {
  db.query(
    `INSERT INTO hash_cache (volume_id, rel_path, size_bytes, mtime_ms, content_id, computed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (volume_id, rel_path, size_bytes, mtime_ms)
     DO UPDATE SET content_id = excluded.content_id, computed_at = excluded.computed_at`
  ).run(
    key.volumeId,
    key.relPath,
    key.sizeBytes,
    toMtimeMs(key.mtimeMs),
    entry.contentId,
    formatTimestamp(entry.computedAt)
  );
};
