import { afterEach, describe, expect, test } from 'bun:test';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../test-helpers.ts';
import { disableCache, renameExclusive } from './native.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

describe.skipIf(process.platform !== 'darwin')(
  'disableCache(F_NOCACHE)',
  () => {
    test('開いたファイルに付けられる。使えない記述子は、エラー', () => {
      const dir = newDir();
      writeFileSync(join(dir, 'a'), 'x');
      const fd = openSync(join(dir, 'a'), 'r');
      try {
        expect(() => disableCache(fd)).not.toThrow();
      } finally {
        closeSync(fd);
      }
      expect(() => disableCache(99_999)).toThrow('F_NOCACHE');
    });
  }
);

describe.skipIf(process.platform !== 'darwin')(
  'renameExclusive(renamex_np の RENAME_EXCL)',
  () => {
    test('同名がなければ、名前を変える(日本語・空白も)', () => {
      const dir = newDir();
      writeFileSync(join(dir, 'a'), 'A');
      expect(renameExclusive(join(dir, 'a'), join(dir, '写真 1.jpg'))).toEqual({
        ok: true,
      });
      expect(existsSync(join(dir, 'a'))).toBe(false);
      expect(readFileSync(join(dir, '写真 1.jpg'), 'utf8')).toBe('A');
    });

    test('同名があれば、上書きせず、exists(どちらのファイルも、そのまま)', () => {
      const dir = newDir();
      writeFileSync(join(dir, 'a'), 'A');
      writeFileSync(join(dir, 'b'), 'B');
      expect(renameExclusive(join(dir, 'a'), join(dir, 'b'))).toEqual({
        ok: false,
        reason: 'exists',
      });
      expect(readFileSync(join(dir, 'a'), 'utf8')).toBe('A');
      expect(readFileSync(join(dir, 'b'), 'utf8')).toBe('B');
    });

    test('元がなければ、error(ENOENT)', () => {
      const dir = newDir();
      const result = renameExclusive(join(dir, 'none'), join(dir, 'x'));
      expect(result).toMatchObject({ ok: false, reason: 'error' });
    });

    test('大文字小文字だけが違う名前も、衝突として扱う(大文字小文字を区別しないファイルシステムのとき)', () => {
      const dir = newDir();
      writeFileSync(join(dir, 'Case.JPG'), 'x');
      const insensitive = existsSync(join(dir, 'case.jpg'));
      writeFileSync(join(dir, 'other'), 'y');
      const result = renameExclusive(join(dir, 'other'), join(dir, 'case.jpg'));
      expect(result.ok).toBe(!insensitive);
    });
  }
);
