import { describe, expect, test } from 'bun:test';
import { countTiming } from './effects';

describe('countTiming(数字ごとの、開始の遅れと長さ)', () => {
  test('同じ値・同じ並び順なら、いつも同じ(毎回ばらばらにならない)', () => {
    expect(countTiming(45, 0)).toEqual(countTiming(45, 0));
  });

  test('遅れは 0〜0.35 秒、長さは 0.65〜1.21 秒の範囲に収まる', () => {
    for (let index = 0; index < 20; index += 1) {
      for (const value of [0, 1, 2, 13, 45, 14820, 1_000_000]) {
        const { delay, duration } = countTiming(value, index);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(duration).toBeGreaterThanOrEqual(0.65);
        expect(duration).toBeLessThanOrEqual(1.21 + 1e-9);
      }
    }
  });

  test('同じ値(1 が 3 つ並ぶ要チェックなど)でも、並び順が違えば、開始か長さが違う', () => {
    const timings = [0, 1, 2, 3].map((index) => countTiming(1, index));
    const distinct = new Set(timings.map((t) => `${t.delay}|${t.duration}`));
    expect(distinct.size).toBe(4);
  });
});
