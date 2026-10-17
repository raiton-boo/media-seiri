import { join, resolve } from 'node:path';

/** `data/` の場所を決める環境変数(仕様書 §8-1) */
export const DATA_DIR_ENV = 'FILE_SEIRI_DATA_DIR';

/** 既定の `data/`: リポジトリの根(このファイルの、3 つ上)の `data/` */
const DEFAULT_DATA_DIR = resolve(import.meta.dir, '../../../../data');

/** `--data-dir` の指定 → 環境変数 → 既定、の順で決める */
export const resolveDataDir = (
  option: string | undefined,
  env: Record<string, string | undefined>
): string => {
  const chosen = option ?? env[DATA_DIR_ENV];
  return chosen ? resolve(chosen) : DEFAULT_DATA_DIR;
};

/** ライブラリごとの、作業用のフォルダ(`data/libraries/<ID>/`) */
export const libraryWorkDir = (dataDir: string, libraryId: string): string =>
  join(dataDir, 'libraries', libraryId);

/** 作業用の台帳のパス(`data/libraries/<ID>/catalog.sqlite`) */
export const ledgerPathFor = (dataDir: string, libraryId: string): string =>
  join(libraryWorkDir(dataDir, libraryId), 'catalog.sqlite');

/** 設定ファイルのパス(`data/config.json`) */
export const configPathFor = (dataDir: string): string =>
  join(dataDir, 'config.json');
