import { describe, expect, test } from 'bun:test';
import { getMeta, getRevision, incrementRevision, setMeta } from './meta.ts';
import { openMemoryLedger } from './test-helpers.ts';

describe('meta', () => {
  test('リビジョンは、0 から始まり、1 ずつ増える', () => {
    const { db } = openMemoryLedger();
    expect(getRevision(db)).toBe(0);
    expect(incrementRevision(db)).toBe(1);
    expect(incrementRevision(db)).toBe(2);
    expect(getRevision(db)).toBe(2);
  });

  test('setMeta は、同じキーを上書きする', () => {
    const { db } = openMemoryLedger();
    expect(getMeta(db, 'note')).toBeUndefined();
    setMeta(db, 'note', 'a');
    setMeta(db, 'note', 'b');
    expect(getMeta(db, 'note')).toBe('b');
  });

  test('リビジョンが整数でないときは、エラー', () => {
    const { db } = openMemoryLedger();
    setMeta(db, 'revision', 'abc');
    expect(() => getRevision(db)).toThrow();
  });
});
