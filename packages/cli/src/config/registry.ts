import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { CliError } from '../cli-error.ts';
import { configPathFor } from './paths.ts';

const CONFIG_VERSION = 1;

export type LibraryEntry = {
  /** ライブラリの根の、絶対パス。ドライブ文字やマウント先が変わったら、記録し直す */
  root: string;
  registeredAt: string;
};

export type Config = {
  version: number;
  /** ライブラリ ID → 場所 */
  libraries: Record<string, LibraryEntry>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseConfig = (text: string, path: string): Config => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CliError(`設定ファイルが、JSON として読めません: ${path}`);
  }
  if (
    !isRecord(raw) ||
    raw.version !== CONFIG_VERSION ||
    !isRecord(raw.libraries)
  ) {
    throw new CliError(`設定ファイルの形式が正しくありません: ${path}`);
  }
  const libraries: Record<string, LibraryEntry> = {};
  for (const [id, entry] of Object.entries(raw.libraries)) {
    if (
      !isRecord(entry) ||
      typeof entry.root !== 'string' ||
      typeof entry.registeredAt !== 'string'
    ) {
      throw new CliError(
        `設定ファイルの、ライブラリ(${id})の項目が正しくありません: ${path}`
      );
    }
    libraries[id] = { root: entry.root, registeredAt: entry.registeredAt };
  }
  return { version: CONFIG_VERSION, libraries };
};

/** 設定を読む。ファイルがなければ、空の設定 */
export const readConfig = (dataDir: string): Config => {
  const path = configPathFor(dataDir);
  if (!existsSync(path)) return { version: CONFIG_VERSION, libraries: {} };
  return parseConfig(readFileSync(path, 'utf8'), path);
};

/** 設定を書く。一時ファイルに書いてから、名前を付け替える(途中で止まっても、前の設定が残る) */
export const writeConfig = (dataDir: string, config: Config): void => {
  const path = configPathFor(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temporaryPath, path);
};

/** ライブラリの場所を記録する(同じ ID があれば、場所を更新する) */
export const registerLibrary = (
  dataDir: string,
  libraryId: string,
  entry: LibraryEntry
): void => {
  const config = readConfig(dataDir);
  config.libraries[libraryId] = entry;
  writeConfig(dataDir, config);
};
