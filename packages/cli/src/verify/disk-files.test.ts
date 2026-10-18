import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../test-helpers.ts';
import { listLibraryDiskFiles } from './disk-files.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const put = (root: string, relPath: string): void => {
  mkdirSync(join(root, relPath, '..'), { recursive: true });
  writeFileSync(join(root, relPath), 'x');
};

describe('listLibraryDiskFiles', () => {
  test('写真などのファイルだけを、パスの順に集める。目印・管理用フォルダ・付属ファイル・一時ファイル・管理用ファイルは、除く', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    for (const path of [
      '2024/03/b.jpg',
      '2024/03/a.jpg',
      '2023/12/_時刻不明/c.mov',
      '_unknown/日付なし/d.jpg',
      '.file-seiri-library.json',
      '.file-seiri/catalog.snapshot.sqlite',
      '.file-seiri/thumbs/x.webp',
      '2024/03/._a.jpg',
      '2024/03/.b.jpg.part',
      '2024/03/.DS_Store',
      '2024/03/Thumbs.db',
      '$RECYCLE.BIN/e.jpg',
    ]) {
      put(dir, path);
    }
    expect(listLibraryDiskFiles(dir)).toEqual([
      '2023/12/_時刻不明/c.mov',
      '2024/03/a.jpg',
      '2024/03/b.jpg',
      '_unknown/日付なし/d.jpg',
    ]);
  });

  test('管理用フォルダ(.file-seiri)は、根の直下だけが対象。下の階層の同名は、通常のフォルダ', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    put(dir, '2024/.file-seiri/a.jpg');
    expect(listLibraryDiskFiles(dir)).toEqual(['2024/.file-seiri/a.jpg']);
  });

  test('シンボリックリンクは、たどらない。空のライブラリは、空', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    expect(listLibraryDiskFiles(dir)).toEqual([]);
    put(dir, 'real/a.jpg');
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
    symlinkSync(join(dir, 'real/a.jpg'), join(dir, 'real/b.jpg'));
    expect(listLibraryDiskFiles(dir)).toEqual(['real/a.jpg']);
  });
});
