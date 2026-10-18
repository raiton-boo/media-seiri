/// <reference path="../sql.d.ts" />

import initial from './0001_initial.sql' with { type: 'text' };
import libraryPathNoCase from './0002_library_path_nocase.sql' with {
  type: 'text',
};
import runKind from './0003_run_kind.sql' with { type: 'text' };
import runKindThumbs from './0004_run_kind_thumbs.sql' with { type: 'text' };

/** 番号つきの移行。番号は 1 から、欠けずに並べる。適用したものは、書き換えない */
export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initial },
  { version: 2, name: 'library-path-nocase', sql: libraryPathNoCase },
  { version: 3, name: 'run-kind', sql: runKind },
  { version: 4, name: 'run-kind-thumbs', sql: runKindThumbs },
];

/** このプログラムが扱える、スキーマの版 */
export const LATEST_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
