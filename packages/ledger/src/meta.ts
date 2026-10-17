import type { Database } from 'bun:sqlite';

const LIBRARY_ID_KEY = 'library_id';
const SCHEMA_VERSION_KEY = 'schema_version';
const REVISION_KEY = 'revision';

type MetaRow = { value: string };

export const getMeta = (db: Database, key: string): string | undefined =>
  db.query<MetaRow, [string]>('SELECT value FROM meta WHERE key = ?').get(key)
    ?.value;

export const setMeta = (db: Database, key: string, value: string): void => {
  db.query(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
};

const getMetaInteger = (db: Database, key: string): number | undefined => {
  const value = getMeta(db, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`meta の ${key} が整数ではありません: ${value}`);
  }
  return parsed;
};

/** ライブラリの目印ファイルと同じ ID */
export const getLibraryId = (db: Database): string | undefined =>
  getMeta(db, LIBRARY_ID_KEY);

export const setLibraryId = (db: Database, libraryId: string): void =>
  setMeta(db, LIBRARY_ID_KEY, libraryId);

/** `meta` に持つ、スキーマの版。`PRAGMA user_version` と同じ値になる */
export const getSchemaVersion = (db: Database): number | undefined =>
  getMetaInteger(db, SCHEMA_VERSION_KEY);

export const setSchemaVersion = (db: Database, version: number): void =>
  setMeta(db, SCHEMA_VERSION_KEY, String(version));

/** 台帳のリビジョン。実行のたびに増える(仕様書 §8-2) */
export const getRevision = (db: Database): number =>
  getMetaInteger(db, REVISION_KEY) ?? 0;

/** リビジョンを 1 増やして、増やしたあとの値を返す */
export const incrementRevision = (db: Database): number => {
  const next = getRevision(db) + 1;
  setMeta(db, REVISION_KEY, String(next));
  return next;
};
