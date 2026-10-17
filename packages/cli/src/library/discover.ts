import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isExcludedName } from '@file-seiri/core';
import { SNAPSHOT_DIRECTORY, SNAPSHOT_FILE_NAME } from '@file-seiri/ledger';
import type { Config } from '../config/registry.ts';
import { markerExists, readMarker } from './marker.ts';

export type FoundLibrary = {
  libraryId: string;
  /** ライブラリの根の、絶対パス */
  root: string;
  /** 最後のスナップショットの更新日時(最後の本実行の終わり)。まだなければ、undefined */
  lastUpdated: Date | undefined;
  /** この Mac の設定に、登録されているか */
  registered: boolean;
};

const lastUpdatedOf = (root: string): Date | undefined => {
  const snapshot = join(root, SNAPSHOT_DIRECTORY, SNAPSHOT_FILE_NAME);
  return existsSync(snapshot) ? statSync(snapshot).mtime : undefined;
};

const describe = (
  root: string,
  registered: boolean
): FoundLibrary | undefined => {
  if (!markerExists(root)) return undefined;
  try {
    const marker = readMarker(root);
    return marker
      ? {
          libraryId: marker.libraryId,
          root,
          lastUpdated: lastUpdatedOf(root),
          registered,
        }
      : undefined;
  } catch {
    // 壊れた目印は、ライブラリとして数えない(一覧の表示を、止めない)
    return undefined;
  }
};

/**
 * ボリュームの中のライブラリを、探す。
 * - この Mac の設定に登録されているもの(場所が、ボリュームの中にあるもの)
 * - `scanRoot` の直下と、その 1 つ下のフォルダにある目印(浅く探す。管理用のフォルダは、見ない)
 * `scanRoot` を省くと(内蔵のデータのボリュームなど)、設定に登録されたものだけ。
 */
export const findLibraries = (input: {
  mountPoint: string;
  scanRoot: string | undefined;
  config: Config;
}): FoundLibrary[] => {
  const found = new Map<string, FoundLibrary>();
  const inside = (path: string): boolean =>
    path === input.mountPoint || path.startsWith(`${input.mountPoint}/`);
  for (const entry of Object.values(input.config.libraries)) {
    if (!inside(entry.root)) continue;
    const library = describe(entry.root, true);
    if (library) found.set(library.root, library);
  }
  if (input.scanRoot) {
    const candidates = [input.scanRoot];
    for (const entry of readdirSync(input.scanRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !isExcludedName(entry.name)
      ) {
        candidates.push(join(input.scanRoot, entry.name));
      }
    }
    for (const root of candidates) {
      if (found.has(root)) continue;
      const library = describe(root, false);
      if (library) found.set(root, library);
    }
  }
  return [...found.values()].sort((a, b) => a.root.localeCompare(b.root));
};
