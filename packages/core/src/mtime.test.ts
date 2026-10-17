import { describe, expect, test } from 'bun:test';
import { toMtimeMs } from './mtime.ts';

describe('toMtimeMs', () => {
  test('整数は、そのまま', () => {
    expect(toMtimeMs(1_700_000_000_123)).toBe(1_700_000_000_123);
  });

  test('小数のミリ秒は、切り捨てる(四捨五入しない)', () => {
    expect(toMtimeMs(1_700_000_000_123.9)).toBe(1_700_000_000_123);
    expect(toMtimeMs(1_700_000_000_123.5)).toBe(1_700_000_000_123);
    expect(toMtimeMs(1_700_000_000_123.25)).toBe(1_700_000_000_123);
  });

  test('1970 年より前は、より小さい整数へ切り捨てる', () => {
    expect(toMtimeMs(-0.5)).toBe(-1);
    expect(toMtimeMs(-1000.2)).toBe(-1001);
  });

  test('同じ値は、何度丸めても同じ(保存と照合で、同じになる)', () => {
    const once = toMtimeMs(1_700_000_000_123.7);
    expect(toMtimeMs(once)).toBe(once);
  });

  test('数でない値は、エラー', () => {
    expect(() => toMtimeMs(Number.NaN)).toThrow(RangeError);
    expect(() => toMtimeMs(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
