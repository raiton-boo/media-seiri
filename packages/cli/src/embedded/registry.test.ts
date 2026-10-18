import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '../config/paths.ts';
import { makeTempDir } from '../test-helpers.ts';
import {
  cacheDir,
  clearEmbedded,
  ensureExiftool,
  hasEmbeddedExiftool,
  isStandalone,
  markStandalone,
  setEmbeddedExiftool,
} from './registry.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  clearEmbedded();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const setup = () => {
  const temp = makeTempDir();
  cleanups.push(temp.cleanup);
  // 埋め込んだファイルの代わり(実行ファイルでは、`$bunfs` の中にある)
  const source = join(temp.dir, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'a'), '#!/bin/sh\necho 13.59\n');
  writeFileSync(join(source, 'b'), 'package Fake;\n1;\n');
  return { temp, source };
};

describe('埋め込んだ ExifTool の展開', () => {
  test('キャッシュに展開し、exiftool を実行できる形にする。2 回目は、展開し直さない', async () => {
    const { temp, source } = setup();
    setEmbeddedExiftool({
      version: '1.2.3',
      files: {
        'bin/exiftool': join(source, 'a'),
        'bin/lib/Image/Fake.pm': join(source, 'b'),
      },
    });
    expect(hasEmbeddedExiftool()).toBe(true);
    const cache = join(temp.dir, 'cache');
    const script = await ensureExiftool(cache);
    expect(script).toBe(join(cache, 'exiftool-1.2.3', 'bin', 'exiftool'));
    expect(readFileSync(script, 'utf8')).toContain('13.59');
    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(
      existsSync(join(cache, 'exiftool-1.2.3', 'bin/lib/Image/Fake.pm'))
    ).toBe(true);

    // 2 回目: 展開済みの印があるので、書き直さない
    writeFileSync(script, 'changed');
    expect(await ensureExiftool(cache)).toBe(script);
    expect(readFileSync(script, 'utf8')).toBe('changed');
  });

  test('展開先の外を指す名前は、書かない', async () => {
    const { temp, source } = setup();
    setEmbeddedExiftool({
      version: '9',
      files: {
        'bin/exiftool': join(source, 'a'),
        '../../evil': join(source, 'b'),
      },
    });
    const cache = join(temp.dir, 'cache');
    await ensureExiftool(cache);
    expect(existsSync(join(temp.dir, 'evil'))).toBe(false);
    expect(existsSync(join(cache, 'evil'))).toBe(false);
  });

  test('埋め込んでいなければ、使えない(投げる)', async () => {
    await expect(ensureExiftool('/nonexistent')).rejects.toThrow(
      '埋め込まれていません'
    );
  });
});

describe('置き場所', () => {
  test('キャッシュは、環境変数・OS ごとの既定', () => {
    expect(cacheDir({ FILE_SEIRI_CACHE_DIR: '/x/y' }, 'darwin')).toBe('/x/y');
    expect(cacheDir({}, 'darwin')).toContain('Library/Caches/file-seiri');
    expect(cacheDir({ XDG_CACHE_HOME: '/c' }, 'linux')).toBe('/c/file-seiri');
  });

  test('単一の実行ファイルの既定の data/ は、実行ファイルの置き場ではなく、利用者の領域', () => {
    const normal = resolveDataDir(undefined, {});
    expect(isStandalone()).toBe(false);
    markStandalone();
    const standalone = resolveDataDir(undefined, {});
    expect(standalone).not.toBe(normal);
    expect(standalone).toContain('file-seiri');
    // 指定があれば、そちらが先
    expect(resolveDataDir('/custom', {})).toBe('/custom');
  });
});
