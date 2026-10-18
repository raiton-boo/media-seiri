import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SNAPSHOT_DIRECTORY, SNAPSHOT_FILE_NAME } from '@file-seiri/ledger';
import { markerExists } from '../library/marker.ts';

export type LocatedLibrary = {
  root: string;
  /** スナップショットの更新日時。まだなければ undefined */
  snapshotAt: Date | undefined;
};

const describe = (root: string): LocatedLibrary => {
  const snapshot = join(root, SNAPSHOT_DIRECTORY, SNAPSHOT_FILE_NAME);
  return {
    root,
    snapshotAt: existsSync(snapshot) ? statSync(snapshot).mtime : undefined,
  };
};

/** フォルダの中の、ライブラリ(目印のあるフォルダ)。隠しフォルダ・読めないフォルダは、飛ばす */
const librariesIn = (directory: string): string[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
      .map((item) => join(directory, item.name))
      .filter((path) => markerExists(path));
  } catch {
    // 権限がない・抜けたなどは、「ない」として扱う
    return [];
  }
};

/**
 * 実行ファイルの置き場所から、ライブラリを探す。置き場所から、上のフォルダへ向かって、
 * 「そのフォルダ自身」→「そのフォルダの直下」の順に見て、見つかった最初の階層で止める。
 * 例: `<ライブラリ>/viewer/` に置けば、1 つ上のライブラリ。`<ドライブ>/viewer/` に置けば、ドライブの直下の `Pictures/` など。
 */
export const locateLibraries = (startDirectory: string): LocatedLibrary[] => {
  let directory = startDirectory;
  for (;;) {
    const found = [
      ...(markerExists(directory) ? [directory] : []),
      ...librariesIn(directory),
    ];
    if (found.length > 0) return found.map(describe);
    const parent = dirname(directory);
    if (parent === directory) return [];
    directory = parent;
  }
};
