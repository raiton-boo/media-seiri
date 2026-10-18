import { existsSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SNAPSHOT_DIRECTORY } from '@file-seiri/ledger';
import { VIEWER_DIRECTORY, VIEWER_FILES } from '../viewer-bundle/install.ts';
import { MARKER_FILE_NAME, markerExists } from './marker.ts';

/** 目印・管理用のフォルダ・OS の付属ファイル。これだけなら、「中身がない」 */
const IGNORED = new Set([
  MARKER_FILE_NAME,
  SNAPSHOT_DIRECTORY,
  VIEWER_DIRECTORY,
  '.DS_Store',
  'Thumbs.db',
  '.Spotlight-V100',
  '.fseventsd',
  '.Trashes',
  'System Volume Information',
  '$RECYCLE.BIN',
]);

const isNoise = (name: string): boolean =>
  IGNORED.has(name) || name.startsWith('._');

/** `viewer/` が、seiri の置いたものだけか(それ以外が入っていれば、触らない) */
const isOnlyOurViewer = (directory: string): boolean => {
  const ours = new Set<string>([...VIEWER_FILES, 'README.txt', '.version']);
  return readdirSync(directory).every(
    (name) => ours.has(name) || name.startsWith('._')
  );
};

/** `.file-seiri/` の中に、スナップショット・サムネイルしかないか(写真のコピーなど、別のものがないか) */
const isOnlyManaged = (directory: string): boolean =>
  readdirSync(directory).every(
    (name) =>
      name.startsWith('catalog.snapshot') ||
      name === 'thumbs' ||
      name.startsWith('._')
  );

/**
 * ライブラリが「空」か: 目印・管理用のフォルダ・OS の付属ファイルのほかに、何もない。
 * 間違えて作った目印を、片づけてよいかの判断に使う(写真が 1 枚でもあれば、空ではない)。
 */
export const isEmptyLibrary = (root: string): boolean => {
  if (!markerExists(root)) return false;
  try {
    return readdirSync(root).every((name) => isNoise(name));
  } catch {
    // 読めないときは、空とは、言えない
    return false;
  }
};

/**
 * 空のライブラリの、目印・管理用のフォルダ・(seiri が置いた)ビューアを、消す。フォルダが空になれば、そのフォルダも消す。
 * 空でなければ、何も消さず、`false`。消したものの一覧を、`removed` に返す。
 */
export const removeEmptyLibrary = (
  root: string
): { removed: string[]; skipped: string[] } | false => {
  if (!isEmptyLibrary(root)) return false;
  const removed: string[] = [];
  const skipped: string[] = [];
  const remove = (path: string): void => {
    rmSync(path, { recursive: true, force: true });
    if (existsSync(path)) skipped.push(path);
    else removed.push(path);
  };
  remove(join(root, MARKER_FILE_NAME));
  const managed = join(root, SNAPSHOT_DIRECTORY);
  if (existsSync(managed)) {
    if (isOnlyManaged(managed)) remove(managed);
    else skipped.push(managed);
  }
  const viewer = join(root, VIEWER_DIRECTORY);
  if (existsSync(viewer)) {
    if (isOnlyOurViewer(viewer)) remove(viewer);
    else skipped.push(viewer);
  }
  // 付属ファイル・OS のごみだけが残ったフォルダは、そのまま(別のものかもしれない)。完全に空なら、フォルダも消す
  try {
    if (readdirSync(root).length === 0) {
      rmdirSync(root);
      removed.push(root);
    }
  } catch {
    // 消せなくても、ライブラリではなくなっているので、問題ない
  }
  return { removed, skipped };
};
