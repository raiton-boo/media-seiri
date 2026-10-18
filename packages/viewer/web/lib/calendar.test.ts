import { describe, expect, test } from 'bun:test';
import { levelOf, longDay, monthCells, shortDay, topDays } from './calendar';

describe('calendar', () => {
  test('濃さ: 0 は写真なし。最多を基準に 4 等分', () => {
    expect(levelOf(0, 100)).toBe(0);
    expect(levelOf(1, 100)).toBe(1);
    expect(levelOf(25, 100)).toBe(1);
    expect(levelOf(26, 100)).toBe(2);
    expect(levelOf(50, 100)).toBe(2);
    expect(levelOf(51, 100)).toBe(3);
    expect(levelOf(76, 100)).toBe(4);
    expect(levelOf(100, 100)).toBe(4);
    expect(levelOf(5, 0)).toBe(0);
  });

  test('月のマス: 2014 年 4 月は、火曜はじまり(空き 2 マス)・30 日', () => {
    const cells = monthCells(2014, 4, new Map([['2014-04-06', 32]]), 120);
    expect(cells.filter((c) => c.kind === 'blank')).toHaveLength(2);
    expect(cells.filter((c) => c.kind === 'day')).toHaveLength(30);
    expect(cells[2]).toMatchObject({ kind: 'day', day: 1, level: 0 });
    expect(cells[7]).toMatchObject({
      kind: 'day',
      date: '2014-04-06',
      count: 32,
      level: 2,
    });
  });

  test('うるう年の 2 月は 29 日。日曜はじまりの月は、空きなし', () => {
    expect(
      monthCells(2016, 2, new Map(), 0).filter((c) => c.kind === 'day')
    ).toHaveLength(29);
    // 2017 年 1 月 1 日は日曜
    expect(monthCells(2017, 1, new Map(), 0)[0]).toMatchObject({
      kind: 'day',
      day: 1,
    });
  });

  test('多かった日: 多い順。同じ枚数なら、新しい日が先', () => {
    const days = [
      { date: '2014-04-20', count: 75 },
      { date: '2014-04-26', count: 120 },
      { date: '2014-05-01', count: 75 },
      { date: '2014-04-27', count: 88 },
    ];
    expect(topDays(days, 3).map((d) => d.date)).toEqual([
      '2014-04-26',
      '2014-04-27',
      '2014-05-01',
    ]);
    expect(days).toHaveLength(4);
  });

  test('日の表示', () => {
    expect(shortDay('2014-04-26')).toBe('4/26(土)');
    expect(longDay('2014-04-06')).toBe('2014年4月6日(日)');
  });
});
