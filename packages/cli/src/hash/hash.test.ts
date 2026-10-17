import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, chmodSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLedger, startRun, upsertVolume } from '@file-seiri/ledger';
import { makeTempDir } from '../test-helpers.ts';
import { resolveContent, SourceChangedError } from './content.ts';
import { HASH_CHUNK_BYTES, type Hasher, hashFile } from './sha256.ts';
import { getHashCacheCount } from './test-support.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

const NOW = new Date('2026-10-18T00:00:00Z');

describe('hashFile', () => {
  test('既知の値(SHA-256 の標準のテストベクトル)', async () => {
    const dir = newDir();
    writeFileSync(join(dir, 'abc'), 'abc');
    writeFileSync(join(dir, 'empty'), '');
    expect(await hashFile(join(dir, 'abc'))).toEqual({
      hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      sizeBytes: 3,
    });
    expect((await hashFile(join(dir, 'empty'))).hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  test('複数のチャンクにまたがるファイルも、全体を一度に計算した値と同じ', async () => {
    const dir = newDir();
    const bytes = new Uint8Array(HASH_CHUNK_BYTES * 2 + 12345).map(
      (_, index) => (index * 31) % 251
    );
    writeFileSync(join(dir, 'big'), bytes);
    const expected = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    expect(await hashFile(join(dir, 'big'))).toEqual({
      hash: expected,
      sizeBytes: bytes.length,
    });
  });

  test('日本語のパスも読める。ないファイル・読めないファイルは、拒否する', async () => {
    const dir = newDir();
    writeFileSync(join(dir, '写真 1.jpg'), 'x');
    expect((await hashFile(join(dir, '写真 1.jpg'))).sizeBytes).toBe(1);
    await expect(hashFile(join(dir, 'none'))).rejects.toThrow();
    writeFileSync(join(dir, 'locked'), 'x');
    chmodSync(join(dir, 'locked'), 0o000);
    try {
      await expect(hashFile(join(dir, 'locked'))).rejects.toThrow();
    } finally {
      chmodSync(join(dir, 'locked'), 0o644);
    }
  });
});

/** 台帳(メモリ)・ボリューム・実行を作る */
const setup = () => {
  const dir = newDir();
  const ledger = openLedger(':memory:', { libraryId: 'abc' });
  const volume = upsertVolume(ledger.db, { volumeUuid: 'v', seenAt: NOW });
  startRun(ledger.db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  const put = (
    name: string,
    content: string,
    mtimeMs = 1_700_000_000_123
  ): {
    absolutePath: string;
    relPath: string;
    sizeBytes: number;
    mtimeMs: number;
  } => {
    const absolutePath = join(dir, name);
    writeFileSync(absolutePath, content);
    utimesSync(absolutePath, mtimeMs / 1000, mtimeMs / 1000);
    return {
      absolutePath,
      relPath: name,
      sizeBytes: Buffer.byteLength(content),
      mtimeMs,
    };
  };
  const counting = (): { hasher: Hasher; calls: () => number } => {
    let count = 0;
    return {
      hasher: (path) => {
        count += 1;
        return hashFile(path);
      },
      calls: () => count,
    };
  };
  return { ledger, volumeId: volume.volumeId, put, counting };
};

describe('resolveContent', () => {
  test('初回は、計算して、内容とキャッシュに保存する。2 回目は、計算しない', async () => {
    const { ledger, volumeId, put, counting } = setup();
    const file = put('a.jpg', 'hello');
    const { hasher, calls } = counting();
    const request = {
      ...file,
      volumeId,
      rehash: false,
      now: () => NOW,
      hasher,
    };

    const first = await resolveContent(ledger.db, request);
    expect(first.fromCache).toBe(false);
    expect(first.content.hash).toHaveLength(64);
    expect(calls()).toBe(1);

    const second = await resolveContent(ledger.db, request);
    expect(second).toEqual({ content: first.content, fromCache: true });
    expect(calls()).toBe(1);
  });

  test('--rehash(rehash: true)は、キャッシュを無視して、計算し直す(同じ内容の行は、増やさない)', async () => {
    const { ledger, volumeId, put, counting } = setup();
    const file = put('a.jpg', 'hello');
    const { hasher, calls } = counting();
    const base = { ...file, volumeId, now: () => NOW, hasher };
    const first = await resolveContent(ledger.db, { ...base, rehash: false });
    const again = await resolveContent(ledger.db, { ...base, rehash: true });
    expect(again.fromCache).toBe(false);
    expect(again.content).toEqual(first.content);
    expect(calls()).toBe(2);
    expect(getHashCacheCount(ledger.db)).toBe(1);
  });

  test('サイズか更新日が変わったら、キャッシュは当たらず、計算し直す', async () => {
    const { ledger, volumeId, put, counting } = setup();
    const { hasher, calls } = counting();
    const make = (file: ReturnType<typeof put>) => ({
      ...file,
      volumeId,
      rehash: false,
      now: () => NOW,
      hasher,
    });
    await resolveContent(ledger.db, make(put('a.jpg', 'hello')));
    const changedSize = await resolveContent(
      ledger.db,
      make(put('a.jpg', 'hello world'))
    );
    const changedTime = await resolveContent(
      ledger.db,
      make(put('a.jpg', 'hello world', 1_800_000_000_000))
    );
    expect([changedSize.fromCache, changedTime.fromCache]).toEqual([
      false,
      false,
    ]);
    expect(calls()).toBe(3);
  });

  test('更新日が小数のミリ秒でも、保存と照合で同じ丸め方になり、キャッシュが当たる', async () => {
    const { ledger, volumeId, put, counting } = setup();
    const file = put('a.jpg', 'hello');
    const { hasher } = counting();
    const base = { ...file, volumeId, rehash: false, now: () => NOW, hasher };
    // 計算した内容の更新日は、ファイルの実際の値(整数)。照合には、小数を渡す
    await resolveContent(ledger.db, base);
    const second = await resolveContent(ledger.db, {
      ...base,
      mtimeMs: file.mtimeMs + 0.7,
    });
    expect(second.fromCache).toBe(true);
  });

  test('同じ内容の別のファイルは、同じ内容の行を指す(内容は 1 行だけ)', async () => {
    const { ledger, volumeId, put, counting } = setup();
    const { hasher } = counting();
    const make = (file: ReturnType<typeof put>) => ({
      ...file,
      volumeId,
      rehash: false,
      now: () => NOW,
      hasher,
    });
    const a = await resolveContent(ledger.db, make(put('a.jpg', 'same')));
    const b = await resolveContent(ledger.db, make(put('b.jpg', 'same')));
    const c = await resolveContent(ledger.db, make(put('c.jpg', 'different')));
    expect(b.content.contentId).toBe(a.content.contentId);
    expect(c.content.contentId).not.toBe(a.content.contentId);
  });

  test('読んだバイト数がスキャンのときと違えば、SourceChangedError(何も保存しない)', async () => {
    const { ledger, volumeId, put } = setup();
    const file = put('a.jpg', 'hello');
    await expect(
      resolveContent(ledger.db, {
        ...file,
        volumeId,
        sizeBytes: 999,
        rehash: false,
        now: () => NOW,
      })
    ).rejects.toBeInstanceOf(SourceChangedError);
    expect(getHashCacheCount(ledger.db)).toBe(0);
    expect(
      (
        ledger.db.query('SELECT count(*) AS n FROM contents').get() as {
          n: number;
        }
      ).n
    ).toBe(0);
  });

  test('計算の間に、ファイルが書き換えられたら、SourceChangedError(何も保存しない)', async () => {
    const { ledger, volumeId, put } = setup();
    const file = put('a.jpg', 'hello');
    const modifying: Hasher = async (path) => {
      const result = await hashFile(path);
      // 計算のあとで、別のプロセスが、追記した
      appendFileSync(path, '!');
      return { ...result, sizeBytes: file.sizeBytes };
    };
    await expect(
      resolveContent(ledger.db, {
        ...file,
        volumeId,
        rehash: false,
        now: () => NOW,
        hasher: modifying,
      })
    ).rejects.toThrow('変更');
    expect(getHashCacheCount(ledger.db)).toBe(0);
  });

  test('読めないファイルは、拒否する(何も保存しない)', async () => {
    const { ledger, volumeId } = setup();
    await expect(
      resolveContent(ledger.db, {
        volumeId,
        relPath: 'none.jpg',
        absolutePath: join(newDir(), 'none.jpg'),
        sizeBytes: 1,
        mtimeMs: 0,
        rehash: false,
        now: () => NOW,
      })
    ).rejects.toThrow();
    expect(getHashCacheCount(ledger.db)).toBe(0);
  });
});
