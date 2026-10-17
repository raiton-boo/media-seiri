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
const listPartFiles = (root: string): string[] => {
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
