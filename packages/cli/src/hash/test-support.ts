import type { Database } from 'bun:sqlite';

/** ハッシュキャッシュの行数(テスト用) */
export const getHashCacheCount = (db: Database): number =>
  (db.query('SELECT count(*) AS n FROM hash_cache').get() as { n: number }).n;
