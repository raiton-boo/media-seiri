import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PART_FILE = /^\..+\.part$/;
const APPLE_DOUBLE_PART_FILE = /^\._\..+\.part$/;
/** スナップショット・サムネイルを置く、ライブラリの管理用フォルダ(中には、コピーの一時ファイルは、ない) */
const MANAGED_DIRECTORY = '.file-seiri';

export type CleanupResult = {
  removed: string[];
  /** 消せなかった(または、消したのに残っている)もの */
  failed: string[];
};

/** 掃除の対象か: 一時ファイル(`.<名前>.part`)と、その付属ファイル(`._.<名前>.part`) */
export const isPartFileName = (name: string): boolean =>
  PART_FILE.test(name) || APPLE_DOUBLE_PART_FILE.test(name);

/** フォルダの下の、掃除の対象を、すべて集める(先に一覧を作る) */
export const listPartFiles = (root: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (directory === root && entry.name === MANAGED_DIRECTORY) continue;
        walk(path);
      } else if (entry.isFile() && isPartFileName(entry.name)) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
};

/**
 * 中断した実行が残した一時ファイルを、ライブラリの根の下から、すべて消す(起動時に行う。仕様書 §7-6)。
 * exFAT では、再帰の削除が、最初の 1 ファイルだけで、エラーなしに止まることがあるため(PoC)、
 * 先に一覧を作って、1 つずつ消し、消えたことを確かめる。
 */
export const cleanupPartFiles = (libraryRoot: string): CleanupResult => {
  const result: CleanupResult = { removed: [], failed: [] };
  for (const path of listPartFiles(libraryRoot)) {
    try {
      rmSync(path, { force: true });
    } catch {
      result.failed.push(path);
      continue;
    }
    if (existsSync(path)) result.failed.push(path);
    else result.removed.push(path);
  }
  return result;
};

/** macOS が、exFAT・FAT の保存先に、書いたファイルやフォルダごとに作る、付属ファイル(AppleDouble)の名前の先頭 */
const APPLE_DOUBLE_PREFIX = '._';

/** 付属ファイルを作る(消す必要がある)ファイルシステム(仕様書 §7-4) */
const APPLE_DOUBLE_FILESYSTEMS = new Set(['exfat', 'fat32', 'fat16', 'fat']);

export const usesAppleDouble = (fsType: string): boolean =>
  APPLE_DOUBLE_FILESYSTEMS.has(fsType);

/** 付属ファイル(`._X`)の候補を、すべて集める(先に一覧を作る)。本体(`X`)が、同じフォルダにあるものだけ */
export const listAppleDoubleFiles = (root: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true });
    const names = new Set(entries.map((entry) => entry.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        entry.isFile() &&
        entry.name.startsWith(APPLE_DOUBLE_PREFIX) &&
        names.has(entry.name.slice(APPLE_DOUBLE_PREFIX.length))
      ) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found;
};

/**
 * 保存先(ライブラリの根)の下の、付属ファイル(`._X`)を、すべて消す(仕様書 §7-4)。
 * macOS は、exFAT・FAT に書いたファイルだけでなく、作ったフォルダ・目印・スナップショットにも付属ファイルを作り、
 * 放っておくと、Windows から見たとき、ファイルが 2 倍に見える。コピーした 1 ファイルごとに消すだけでは、足りない。
 * 本体(`X`)が同じフォルダにあるものだけを消す(本体のない `._X` は、別のものかもしれないため、残す)。
 * 先に一覧を作って、1 つずつ消し、消えたことを確かめる(exFAT の再帰削除の問題。PoC)。
 */
export const cleanupAppleDouble = (libraryRoot: string): CleanupResult => {
  const result: CleanupResult = { removed: [], failed: [] };
  for (const path of listAppleDoubleFiles(libraryRoot)) {
    try {
      rmSync(path, { force: true });
    } catch {
      result.failed.push(path);
      continue;
    }
    if (existsSync(path)) result.failed.push(path);
    else result.removed.push(path);
  }
  return result;
};
