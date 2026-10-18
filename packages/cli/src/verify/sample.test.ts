import { describe, expect, test } from 'bun:test';
import { CliError } from '../cli-error.ts';
import { parseSampleRatio, pickSample } from './sample.ts';

describe('parseSampleRatio', () => {
  test('割合(0.1)と、百分率(10%)を読む。境界の 1 と 100% も、通る', () => {
    expect(parseSampleRatio('0.1')).toBe(0.1);
    expect(parseSampleRatio('10%')).toBeCloseTo(0.1);
    expect(parseSampleRatio(' 50% ')).toBe(0.5);
    expect(parseSampleRatio('1')).toBe(1);
    expect(parseSampleRatio('100%')).toBe(1);
    expect(parseSampleRatio('0.01%')).toBeCloseTo(0.0001);
  });

  test('0・負・1 超・文字・空は、エラー', () => {
    for (const text of [
      '0',
      '0%',
      '-0.1',
      '1.5',
      '150%',
      'abc',
      '',
      '%',
      'NaN',
      'Infinity',
    ]) {
      expect(() => parseSampleRatio(text)).toThrow(CliError);
    }
  });
});

describe('pickSample', () => {
  const items = Array.from({ length: 100 }, (_, index) => index);
  const seeded = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  };

  test('割合に応じた数(切り上げ)を、重複なく、元の並びで選ぶ', () => {
    const picked = pickSample(items, 0.1, seeded(1));
    expect(picked).toHaveLength(10);
    expect(new Set(picked).size).toBe(10);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    expect(pickSample(items, 0.255, seeded(2))).toHaveLength(26);
  });

  test('少なくとも 1 件。1 以上の割合・空の入力は、そのまま', () => {
    expect(pickSample(items, 0.0001, seeded(3))).toHaveLength(1);
    expect(pickSample(items, 1, seeded(4))).toEqual(items);
    expect(pickSample([], 0.5, seeded(5))).toEqual([]);
    expect(pickSample([7], 0.5, seeded(6))).toEqual([7]);
  });

  test('同じ乱数なら、同じ結果。違う乱数なら、違う選び方(偏らない)', () => {
    expect(pickSample(items, 0.1, seeded(7))).toEqual(
      pickSample(items, 0.1, seeded(7))
    );
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed += 1)
      for (const item of pickSample(items, 0.1, seeded(seed))) seen.add(item);
    // 何度か抜き取れば、ほぼ全体に当たる(先頭だけに偏らない)
    expect(seen.size).toBeGreaterThan(95);
  });

  test('入力は、書き換えない', () => {
    const copy = [...items];
    pickSample(items, 0.3, seeded(8));
    expect(items).toEqual(copy);
  });
});
