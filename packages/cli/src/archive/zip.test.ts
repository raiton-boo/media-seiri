import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, CP932_AIU, type TestEntry } from './test-zip.ts';
import { decodeEntryName, safeSegments } from './zip-names.ts';
import {
  extractZipEntry,
  readZipEntries,
  ZipExtractError,
  ZipReadError,
} from './zip-reader.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-zip-'));
  dirs.push(dir);
  return dir;
};
const zipOf = (
  entries: TestEntry[],
  options?: { centralDirectory?: boolean }
): string => {
  const path = join(temp(), 'a.zip');
  writeFileSync(path, buildZip(entries, options));
  return path;
};
const LIMIT = { maxBytes: 1024 * 1024 };

describe('名前の判定', () => {
  test('UTF-8 の印があれば UTF-8。ASCII だけなら、そのまま', () => {
    expect(decodeEntryName(Buffer.from('写真.jpg'), true)).toBe('写真.jpg');
    expect(decodeEntryName(Buffer.from('a/b.jpg'), false)).toBe('a/b.jpg');
  });
  test('印がなく、UTF-8 として読めなければ cp932。UTF-8 として読めれば、UTF-8', () => {
    expect(decodeEntryName(CP932_AIU, false)).toBe('あいう');
    expect(decodeEntryName(Buffer.from('写真.jpg'), false)).toBe('写真.jpg');
  });
  test('NFC にそろえる(NFD の「が」)', () => {
    const nfd = 'か\u3099';
    expect(decodeEntryName(Buffer.from(nfd), true)).toBe('が');
  });
});

describe('安全なパス', () => {
  test('普通のパスは、区切って返す。空・. は、除く', () => {
    expect(safeSegments('a//b/./c.jpg')).toEqual({
      ok: true,
      segments: ['a', 'b', 'c.jpg'],
    });
  });
  test('上へ出る・絶対・ドライブ・NUL・空は、拒む', () => {
    for (const bad of [
      '../x.jpg',
      'a/../../x.jpg',
      '/etc/passwd',
      'C:/x.jpg',
      'c:x',
      'a\0b',
      '',
      '/',
      '..\\x.jpg',
    ]) {
      expect(safeSegments(bad).ok).toBe(false);
    }
  });
  test('名前の一部の ".." は、許す(`a..b`)', () => {
    expect(safeSegments('a..b/c.jpg').ok).toBe(true);
  });
});

describe('エントリの一覧と取り出し', () => {
  test('保存・Deflate の両方を読める。フォルダ・更新日・名前', async () => {
    const path = zipOf([
      { name: 'dir/' },
      {
        name: 'dir/a.jpg',
        data: 'AAAA'.repeat(1000),
        method: 'deflate',
        mtime: new Date(2014, 3, 6, 15, 32, 4),
      },
      { name: 'b.txt', data: 'hello' },
    ]);
    const entries = readZipEntries(path);
    expect(entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['dir/', true],
      ['dir/a.jpg', false],
      ['b.txt', false],
    ]);
    expect(entries[1]?.mtimeMs).toBe(new Date(2014, 3, 6, 15, 32, 4).getTime());
    const out = join(temp(), 'a.jpg');
    await extractZipEntry(
      path,
      entries[1] as NonNullable<(typeof entries)[number]>,
      out,
      LIMIT
    );
    expect(readFileSync(out, 'utf8')).toBe('AAAA'.repeat(1000));
    const out2 = join(temp(), 'b.txt');
    await extractZipEntry(
      path,
      entries[2] as NonNullable<(typeof entries)[number]>,
      out2,
      LIMIT
    );
    expect(readFileSync(out2, 'utf8')).toBe('hello');
  });

  test('cp932 の名前', () => {
    const path = zipOf([{ name: CP932_AIU, data: 'x' }]);
    expect(readZipEntries(path)[0]?.name).toBe('あいう');
  });

  test('空のファイル(0 バイト)', async () => {
    const path = zipOf([{ name: 'empty.jpg' }]);
    const entry = readZipEntries(path)[0] as NonNullable<
      ReturnType<typeof readZipEntries>[number]
    >;
    const out = join(temp(), 'e');
    await extractZipEntry(path, entry, out, LIMIT);
    expect(readFileSync(out).length).toBe(0);
  });

  test('暗号化は encrypted。CRC の不一致は corrupt(書きかけを残さない)', async () => {
    const path = zipOf([
      { name: 'enc.jpg', data: 'x', encrypted: true },
      { name: 'bad.jpg', data: 'xyz', badCrc: true },
    ]);
    const [enc, bad] = readZipEntries(path) as [
      ReturnType<typeof readZipEntries>[number],
      ReturnType<typeof readZipEntries>[number],
    ];
    const out = join(temp(), 'o');
    await expect(extractZipEntry(path, enc, out, LIMIT)).rejects.toMatchObject({
      kind: 'encrypted',
    });
    await expect(extractZipEntry(path, bad, out, LIMIT)).rejects.toMatchObject({
      kind: 'corrupt',
    });
    expect(existsSync(out)).toBe(false);
  });

  test('展開サイズの上限: 宣言が超える・実際が宣言を超える、どちらも止める', async () => {
    const path = zipOf([
      { name: 'big.bin', data: 'A'.repeat(5000), method: 'deflate' },
    ]);
    const entry = readZipEntries(path)[0] as NonNullable<
      ReturnType<typeof readZipEntries>[number]
    >;
    const out = join(temp(), 'o');
    await expect(
      extractZipEntry(path, entry, out, { maxBytes: 1000 })
    ).rejects.toBeInstanceOf(ZipExtractError);
    // 宣言のサイズを小さくして、実際は大きい(ZIP 爆弾)
    const lying = { ...entry, uncompressedSize: 10 };
    await expect(
      extractZipEntry(path, lying, out, LIMIT)
    ).rejects.toMatchObject({ kind: 'too-large' });
    expect(existsSync(out)).toBe(false);
  });

  test('壊れた ZIP: 中央ディレクトリがなくても、局所ヘッダから、読める分を救う', () => {
    const path = zipOf(
      [
        { name: 'a.jpg', data: 'AAA' },
        { name: 'b.jpg', data: 'BBB' },
      ],
      { centralDirectory: false }
    );
    try {
      readZipEntries(path);
      throw new Error('読めてはいけない');
    } catch (error) {
      expect(error).toBeInstanceOf(ZipReadError);
      expect((error as ZipReadError).partial.map((e) => e.name)).toEqual([
        'a.jpg',
        'b.jpg',
      ]);
    }
  });

  test('ZIP ではないファイル: 救えるものがなく、partial は空', () => {
    const path = join(temp(), 'x.zip');
    writeFileSync(path, 'not a zip at all');
    try {
      readZipEntries(path);
      throw new Error('読めてはいけない');
    } catch (error) {
      expect((error as ZipReadError).partial).toEqual([]);
    }
  });
});
