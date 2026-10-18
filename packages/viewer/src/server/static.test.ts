import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setEmbeddedWeb } from './embedded.ts';
import { staticFiles } from './static.ts';
import { makeSource } from './test-support.ts';

afterEach(() => setEmbeddedWeb(undefined));

describe('画面の配信', () => {
  test('ディスクの書き出しから返す(拡張子なし・index・外へは出ない)', async () => {
    const source = makeSource();
    const dir = join(source.thumbsDir, '..', 'web');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), 'top');
    writeFileSync(join(dir, 'errors.html'), 'errors');
    const serve = staticFiles(dir);
    expect(await serve('/')?.text()).toBe('top');
    expect(await serve('/errors')?.text()).toBe('errors');
    expect(serve('/../x')).toBeUndefined();
    expect(serve('/missing')).toBeUndefined();
  });

  test('埋め込んだ画面(単一の実行ファイル)があれば、それだけを返す', async () => {
    const source = makeSource();
    const dir = join(source.thumbsDir, '..', 'embedded-src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'i'), 'embedded-top');
    writeFileSync(join(dir, 'e'), 'embedded-errors');
    setEmbeddedWeb({
      '/index.html': join(dir, 'i'),
      '/errors.html': join(dir, 'e'),
    });
    // ディスクの場所は、使わない(存在しなくてもよい)
    const serve = staticFiles('/nonexistent');
    expect(await serve('/')?.text()).toBe('embedded-top');
    expect(await serve('/errors')?.text()).toBe('embedded-errors');
    expect(serve('/other')).toBeUndefined();
  });
});
