import { describe, expect, test } from 'bun:test';
import { barHeight, barPercent, periodLabel, stackHeights } from './stats';

describe('stats', () => {
  test('棒の高さ: 最大が最大。0 は 0。小さくても、見える', () => {
    expect(barHeight(100, 100, 200)).toBe(200);
    expect(barHeight(50, 100, 200)).toBe(100);
    expect(barHeight(0, 100, 200)).toBe(0);
    expect(barHeight(1, 10000, 200)).toBe(6);
    expect(barHeight(5, 0, 200)).toBe(0);
  });

  test('積み上げ: 段の合計が、棒の高さに合う。0 の段は 0', () => {
    const heights = stackHeights([3, 0, 1], 4, 100);
    expect(heights.reduce((a, b) => a + b, 0)).toBe(100);
    expect(heights[1]).toBe(0);
    expect(stackHeights([1, 1, 1], 3, 100).reduce((a, b) => a + b, 0)).toBe(
      100
    );
    expect(stackHeights([0, 0, 0], 3, 100)).toEqual([0, 0, 0]);
  });

  test('横棒の幅', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(1, 10000)).toBe(2);
    expect(barPercent(0, 10)).toBe(0);
  });

  test('期間の表示', () => {
    expect(periodLabel('2014-12-05T10:00:00')).toBe('2014.12');
    expect(periodLabel('2014')).toBe('2014');
  });
});
