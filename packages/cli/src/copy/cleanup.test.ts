import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../test-helpers.ts';
import { cleanupPartFiles, isPartFileName } from './cleanup.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const put = (root: string, relPath: string): void => {
  mkdirSync(join(root, relPath, '..'), { recursive: true });
  writeFileSync(join(root, relPath), 'x');
};

describe('isPartFileName', () => {
  test('.<名前>.part と、その付属ファイルだけ', () => {
    expect(isPartFileName('.a.jpg.part')).toBe(true);
    expect(isPartFileName('._.a.jpg.part')).toBe(true);
    expect(isPartFileName('a.jpg.part')).toBe(false);
    expect(isPartFileName('.part')).toBe(false);
    expect(isPartFileName('..part')).toBe(false);
    expect(isPartFileName('a.jpg')).toBe(false);
    expect(isPartFileName('.DS_Store')).toBe(false);
  });
});

describe('cleanupPartFiles', () => {
  test('一時ファイルを、入れ子のフォルダまで、すべて消し、ほかのファイルは残す', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    for (const path of [
      '2024/03/a.jpg',
      '2024/03/.b.jpg.part',
      '2024/03/._.b.jpg.part',
      '2024/04/_時刻不明/.c.jpg.part',
      '_unknown/日付なし/.d.mov.part',
      '.e.jpg.part',
      '2024/03/keep.part.jpg',
      '2024/03/._a.jpg',
      '.file-seiri-library.json',
      '.file-seiri/catalog.snapshot.sqlite',
      '.file-seiri/.not-ours.part',
    ]) {
      put(dir, path);
    }
    const result = cleanupPartFiles(dir);
    expect(result.failed).toEqual([]);
    expect(
      result.removed.map((path) => path.slice(dir.length + 1)).sort()
    ).toEqual([
      '.e.jpg.part',
      '2024/03/._.b.jpg.part',
      '2024/03/.b.jpg.part',
      '2024/04/_時刻不明/.c.jpg.part',
      '_unknown/日付なし/.d.mov.part',
    ]);
    // 通常のファイル・付属ファイル・管理用フォルダの中は、そのまま
    expect(existsSync(join(dir, '2024/03/a.jpg'))).toBe(true);
    expect(existsSync(join(dir, '2024/03/._a.jpg'))).toBe(true);
    expect(existsSync(join(dir, '2024/03/keep.part.jpg'))).toBe(true);
    expect(existsSync(join(dir, '.file-seiri/.not-ours.part'))).toBe(true);
    expect(readdirSync(join(dir, '2024/03')).sort()).toEqual([
      '._a.jpg',
      'a.jpg',
      'keep.part.jpg',
    ]);
  });

  test('なければ、何もしない。空のフォルダも、エラーにならない', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    expect(cleanupPartFiles(dir)).toEqual({ removed: [], failed: [] });
  });

  test('消せなかったもの(読み取り専用のフォルダの中)は、failed に入れる', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    put(dir, 'locked/.a.jpg.part');
    put(dir, 'ok/.b.jpg.part');

    chmodSync(join(dir, 'locked'), 0o555);
    try {
      const result = cleanupPartFiles(dir);
      expect(result.removed.map((p) => p.slice(dir.length + 1))).toEqual([
        'ok/.b.jpg.part',
      ]);
      expect(result.failed.map((p) => p.slice(dir.length + 1))).toEqual([
        'locked/.a.jpg.part',
      ]);
    } finally {
      chmodSync(join(dir, 'locked'), 0o755);
    }
  });
});
