import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_SPEED,
  nextSpeed,
  parseSpeed,
  progressOf,
  shuffled,
} from './slideshow';

describe('slideshow', () => {
  test('速度: 選択肢だけ。ほかは既定。次の速度は、めぐる', () => {
    expect(parseSpeed('5')).toBe(5);
    expect(parseSpeed('4')).toBe(DEFAULT_SPEED);
    expect(parseSpeed(undefined)).toBe(DEFAULT_SPEED);
    expect(nextSpeed(3)).toBe(5);
    expect(nextSpeed(10)).toBe(2);
  });

  test('シャッフル: 同じ種なら同じ並び。全部が 1 回ずつ。元は変えない', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const a = shuffled(items, 42);
    expect(a).toEqual(shuffled(items, 42));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(a).not.toEqual(shuffled(items, 43));
    expect(items[0]).toBe(0);
    expect(shuffled([], 1)).toEqual([]);
  });

  test('進み具合は、0〜1 に収める', () => {
    expect(progressOf(1500, 3000)).toBe(0.5);
    expect(progressOf(9999, 3000)).toBe(1);
    expect(progressOf(-5, 3000)).toBe(0);
    expect(progressOf(0, 0)).toBe(1);
  });
});
