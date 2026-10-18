import { describe, expect, test } from 'bun:test';
import { layoutRows } from './layout-rows';

describe('layoutRows', () => {
  test('空・幅 0 は、行なし', () => {
    expect(layoutRows([], 800, 200, 10)).toEqual([]);
    expect(layoutRows([{ ratio: 1 }], 0, 200, 10)).toEqual([]);
  });

  test('埋まった行は、幅がちょうどになる高さに縮む', () => {
    const items = Array.from({ length: 6 }, () => ({ ratio: 1.5 }));
    const rows = layoutRows(items, 1000, 200, 10);
    // 3 枚で 900 + 20 = 920 < 1000、4 枚で 1220 ≥ 1000 → 4 枚で 1 行
    expect(rows[0]).toMatchObject({ start: 0, end: 4 });
    const first = rows[0];
    if (!first) throw new Error('行がない');
    expect(first.height * 1.5 * 4 + 30).toBeCloseTo(1000);
  });

  test('最後の埋まらない行は、目標の高さのまま', () => {
    const rows = layoutRows([{ ratio: 1 }, { ratio: 1 }], 1000, 200, 10);
    expect(rows).toEqual([{ start: 0, end: 2, height: 200 }]);
  });

  test('全部の写真が、ちょうど 1 回ずつ入る', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({
      ratio: 0.7 + (i % 4) * 0.4,
    }));
    const rows = layoutRows(items, 900, 180, 8);
    expect(rows[0]?.start).toBe(0);
    for (let i = 1; i < rows.length; i += 1)
      expect(rows[i]?.start).toBe(rows[i - 1]?.end);
    expect(rows[rows.length - 1]?.end).toBe(23);
  });
});
