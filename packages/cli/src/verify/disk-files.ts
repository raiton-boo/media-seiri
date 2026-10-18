import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isExcludedName } from '@file-seiri/core';
import { SNAPSHOT_DIRECTORY } from '@file-seiri/ledger';
import { isPartFileName } from '../copy/index.ts';
import { MARKER_FILE_NAME } from '../library/marker.ts';

const APPLE_DOUBLE_PREFIX = '._';

/**
 * ライブラリの下の、検査の対象になる(台帳に載るはずの)ファイルの、相対パス(`/` 区切り)を、すべて集める。
 * 除くもの: 目印・管理用フォルダ(`.file-seiri/`)・付属ファイル(`._X`)・コピーの一時ファイル(`.part`)・
 * ドライブの管理用のファイル(`.DS_Store` など)。シンボリックリンクは、たどらない。
 */
export const listLibraryDiskFiles = (libraryRoot: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (
        prefix === '' &&
        (entry.name === SNAPSHOT_DIRECTORY || entry.name === MARKER_FILE_NAME)
      )
        continue;
      if (
        isExcludedName(entry.name) ||
        entry.name.startsWith(APPLE_DOUBLE_PREFIX) ||
        isPartFileName(entry.name)
      )
        continue;
      if (entry.isDirectory()) walk(join(directory, entry.name), relPath);
      else if (entry.isFile()) found.push(relPath);
    }
  };
  walk(libraryRoot, '');
  return found.sort();
};
