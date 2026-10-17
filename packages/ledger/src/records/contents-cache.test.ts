import { describe, expect, test } from 'bun:test';
import { toMtimeMs } from '@file-seiri/core';
import {
  findContentByHash,
  getContent,
  getOrCreateContent,
} from './contents.ts';
import { openDb, seedRun, T0, T1 } from './fixtures.ts';
import { findCachedContentId, putHashCache } from './hash-cache.ts';

const HASH = 'f'.repeat(64);

describe('contents', () => {
  test('同じハッシュは、1 行だけ(2 度目は、isNew が false)', () => {
    const db = openDb();
    const first = getOrCreateContent(db, { hash: HASH, sizeBytes: 10 });
    const second = getOrCreateContent(db, { hash: HASH, sizeBytes: 10 });
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.content).toEqual(first.content);
    expect(findContentByHash(db, HASH)).toEqual(first.content);
    expect(getContent(db, first.content.contentId)).toEqual(first.content);
  });

  test('ないものは undefined', () => {
    const db = openDb();
    expect(findContentByHash(db, HASH)).toBeUndefined();
    expect(getContent(db, 1)).toBeUndefined();
  });

  test('同じハッシュで、サイズが違うときは、エラー', () => {
    const db = openDb();
    getOrCreateContent(db, { hash: HASH, sizeBytes: 10 });
    expect(() => getOrCreateContent(db, { hash: HASH, sizeBytes: 11 })).toThrow(
      'サイズが違います'
    );
  });
});

describe('hash_cache', () => {
  const setup = () => {
    const db = openDb();
    const { volumeId } = seedRun(db);
    const { content } = getOrCreateContent(db, { hash: HASH, sizeBytes: 10 });
    const key = {
      volumeId,
      relPath: 'DCIM/a.jpg',
      sizeBytes: 10,
      mtimeMs: 1_700_000_000_123,
    };
    return { db, key, contentId: content.contentId };
  };

  test('保存したキーで、内容の ID が見つかる', () => {
    const { db, key, contentId } = setup();
    expect(findCachedContentId(db, key)).toBeUndefined();
    putHashCache(db, key, { contentId, computedAt: T0 });
    expect(findCachedContentId(db, key)).toBe(contentId);
  });

  test('保存と照合で、同じ丸め方(切り捨て)。小数のミリ秒でも、当たる', () => {
    const { db, key, contentId } = setup();
    putHashCache(
      db,
      { ...key, mtimeMs: 1_700_000_000_123.9 },
      { contentId, computedAt: T0 }
    );
    expect(
      findCachedContentId(db, { ...key, mtimeMs: 1_700_000_000_123.2 })
    ).toBe(contentId);
    expect(
      findCachedContentId(db, { ...key, mtimeMs: 1_700_000_000_123 })
    ).toBe(contentId);
    expect(
      findCachedContentId(db, {
        ...key,
        mtimeMs: toMtimeMs(1_700_000_000_124.1),
      })
    ).toBeUndefined();
  });

  test('サイズ・更新日・パス・ボリュームのどれかが違えば、当たらない(無効)', () => {
    const { db, key, contentId } = setup();
    putHashCache(db, key, { contentId, computedAt: T0 });
    expect(findCachedContentId(db, { ...key, sizeBytes: 11 })).toBeUndefined();
    expect(
      findCachedContentId(db, { ...key, mtimeMs: key.mtimeMs + 1 })
    ).toBeUndefined();
    expect(
      findCachedContentId(db, { ...key, relPath: 'DCIM/b.jpg' })
    ).toBeUndefined();
    expect(
      findCachedContentId(db, { ...key, volumeId: key.volumeId + 1 })
    ).toBeUndefined();
  });

  test('同じキーに保存し直すと、上書きする', () => {
    const { db, key, contentId } = setup();
    const other = getOrCreateContent(db, {
      hash: 'e'.repeat(64),
      sizeBytes: 10,
    }).content.contentId;
    putHashCache(db, key, { contentId, computedAt: T0 });
    putHashCache(db, key, { contentId: other, computedAt: T1 });
    expect(findCachedContentId(db, key)).toBe(other);
  });

  test('ない内容は、指せない', () => {
    const { db, key } = setup();
    expect(() =>
      putHashCache(db, key, { contentId: 999, computedAt: T0 })
    ).toThrow();
  });

  test('数でない更新日は、エラー', () => {
    const { db, key } = setup();
    expect(() =>
      findCachedContentId(db, { ...key, mtimeMs: Number.NaN })
    ).toThrow(RangeError);
  });
});
