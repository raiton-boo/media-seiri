import { describe, expect, test } from 'bun:test';
import type { DateOptions } from './types.ts';
import {
  formatTakenAt,
  isExistingDate,
  precisionOf,
  validatedPrecision,
} from './validate.ts';

// 2026-10-18 03:00 JST
const OPTIONS: DateOptions = {
  now: new Date('2026-10-18T03:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
};

describe('isExistingDate', () => {
  test('存在する日付・時刻', () => {
    expect(
      isExistingDate({
        year: 2024,
        month: 2,
        day: 29,
        hour: 23,
        minute: 59,
        second: 59,
      })
    ).toBe(true);
    expect(isExistingDate({ year: 2024, month: 5 })).toBe(true);
    expect(isExistingDate({ year: 2024 })).toBe(true);
  });

  test('存在しない日付・時刻', () => {
    expect(isExistingDate({ year: 2023, month: 2, day: 29 })).toBe(false);
    expect(isExistingDate({ year: 2024, month: 13, day: 1 })).toBe(false);
    expect(isExistingDate({ year: 2024, month: 4, day: 31 })).toBe(false);
    expect(
      isExistingDate({
        year: 2024,
        month: 5,
        day: 1,
        hour: 24,
        minute: 0,
        second: 0,
      })
    ).toBe(false);
    expect(
      isExistingDate({
        year: 2024,
        month: 5,
        day: 1,
        hour: 12,
        minute: 60,
        second: 0,
      })
    ).toBe(false);
  });
});

describe('precisionOf', () => {
  test('部品の数で、精度が決まる', () => {
    expect(precisionOf({ year: 2024 })).toBe('year');
    expect(precisionOf({ year: 2024, month: 5 })).toBe('month');
    expect(precisionOf({ year: 2024, month: 5, day: 1 })).toBe('date');
    expect(
      precisionOf({
        year: 2024,
        month: 5,
        day: 1,
        hour: 1,
        minute: 2,
        second: 3,
      })
    ).toBe('full');
  });
});

describe('validatedPrecision(仕様書 §3-3 の「無効」)', () => {
  test('有効な日時は、その精度を返す', () => {
    expect(
      validatedPrecision(
        { year: 2014, month: 4, day: 6, hour: 15, minute: 32, second: 3 },
        OPTIONS
      )
    ).toBe('full');
    expect(validatedPrecision({ year: 2014, month: 4, day: 6 }, OPTIONS)).toBe(
      'date'
    );
  });

  test('1970 年より前は、無効', () => {
    expect(
      validatedPrecision(
        { year: 1969, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
        OPTIONS
      )
    ).toBeUndefined();
    expect(
      validatedPrecision(
        { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
        OPTIONS
      )
    ).toBe('full');
  });

  test('0000 は、無効', () => {
    expect(
      validatedPrecision(
        { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 },
        OPTIONS
      )
    ).toBeUndefined();
  });

  test('実行時点より未来は、無効(精度に応じて比べる)', () => {
    expect(validatedPrecision({ year: 2027 }, OPTIONS)).toBeUndefined();
    expect(
      validatedPrecision({ year: 2026, month: 11 }, OPTIONS)
    ).toBeUndefined();
    expect(
      validatedPrecision({ year: 2026, month: 10, day: 19 }, OPTIONS)
    ).toBeUndefined();
    // 同じ日でも、現在の時刻(03:00)より後の時刻は、未来
    expect(
      validatedPrecision(
        { year: 2026, month: 10, day: 18, hour: 12, minute: 0, second: 0 },
        OPTIONS
      )
    ).toBeUndefined();
    // 同じ年・月・日までは、未来ではない
    expect(
      validatedPrecision({ year: 2026, month: 10, day: 18 }, OPTIONS)
    ).toBe('date');
    expect(validatedPrecision({ year: 2026, month: 10 }, OPTIONS)).toBe(
      'month'
    );
    expect(validatedPrecision({ year: 2026 }, OPTIONS)).toBe('year');
  });

  test('存在しない日付は、無効', () => {
    expect(
      validatedPrecision({ year: 2024, month: 2, day: 30 }, OPTIONS)
    ).toBeUndefined();
  });
});

describe('formatTakenAt(台帳の taken_at)', () => {
  test('精度までの、ローカル時刻の文字列', () => {
    expect(
      formatTakenAt({
        year: 2014,
        month: 4,
        day: 6,
        hour: 15,
        minute: 32,
        second: 3,
      })
    ).toBe('2014-04-06T15:32:03');
    expect(formatTakenAt({ year: 2014, month: 4, day: 6 })).toBe('2014-04-06');
    expect(formatTakenAt({ year: 2014, month: 4 })).toBe('2014-04');
    expect(formatTakenAt({ year: 2014 })).toBe('2014');
  });
});
