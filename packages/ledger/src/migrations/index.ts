import initial from './0001_initial.sql' with { type: 'text' };

/** 番号つきの移行。番号は 1 から、欠けずに並べる。適用したものは、書き換えない */
export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initial },
];

/** このプログラムが扱える、スキーマの版 */
export const LATEST_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
