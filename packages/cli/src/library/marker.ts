import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../cli-error.ts';

/** ライブラリの根に置く、目印のファイル名(仕様書 §2-1) */
export const MARKER_FILE_NAME = '.file-seiri-library.json';

export type LibraryMarker = {
  libraryId: string;
  /** 作成日(UTC の ISO 8601) */
  createdAt: string;
  /** 作成したときの、台帳のスキーマの版 */
  schemaVersion: number;
};

export const markerPathOf = (libraryRoot: string): string =>
  join(libraryRoot, MARKER_FILE_NAME);

export const markerExists = (libraryRoot: string): boolean =>
  existsSync(markerPathOf(libraryRoot));

/** 目印を作る。すでにあるときは、上書きせず、エラー(`wx`: 排他的に作る) */
export const writeMarker = (
  libraryRoot: string,
  marker: LibraryMarker
): void => {
  writeFileSync(
    markerPathOf(libraryRoot),
    `${JSON.stringify(marker, null, 2)}\n`,
    {
      flag: 'wx',
    }
  );
};

/** 目印を読む。なければ undefined。壊れていれば、エラー(別のものとして、扱わない) */
export const readMarker = (libraryRoot: string): LibraryMarker | undefined => {
  const path = markerPathOf(libraryRoot);
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new CliError(`ライブラリの目印が、JSON として読めません: ${path}`);
  }
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const { libraryId, createdAt, schemaVersion } = record;
  if (
    typeof libraryId !== 'string' ||
    libraryId === '' ||
    typeof createdAt !== 'string' ||
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion)
  ) {
    throw new CliError(`ライブラリの目印の形式が正しくありません: ${path}`);
  }
  return { libraryId, createdAt, schemaVersion };
};
