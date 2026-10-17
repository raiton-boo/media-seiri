import { describe, expect, test } from 'bun:test';
import { parseFilenameDate } from './filename.ts';
import type { DateOptions, DateParts } from './types.ts';
import { precisionOf } from './validate.ts';

// 2026-10-18 03:00 JST。実行日に左右されないよう、固定する
const OPTIONS: DateOptions = {
  now: new Date('2026-10-18T03:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
};

/** date-resolution.md §4 の表の「例」と「読み取り結果」 */
const FOUND_CASES: {
  fileName: string;
  precision: 'full' | 'date' | 'month';
  parts: DateParts;
}[] = [
  {
    fileName: 'IMG_20240501_123456.jpg',
    precision: 'full',
    parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 34, second: 56 },
  },
  {
    fileName: 'PXL_20240501_123456789.jpg',
    precision: 'full',
    parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 34, second: 56 },
  },
  {
    fileName: '2024-05-01 12.34.56.jpg',
    precision: 'full',
    parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 34, second: 56 },
  },
  {
    fileName: '20240501.jpg',
    precision: 'date',
    parts: { year: 2024, month: 5, day: 1 },
  },
  {
    fileName: '2024-05.jpg',
    precision: 'month',
    parts: { year: 2024, month: 5 },
  },
  {
    fileName: '2014-04-01-12-30-45_photo.jpg',
    precision: 'full',
    parts: { year: 2014, month: 4, day: 1, hour: 12, minute: 30, second: 45 },
  },
  {
    fileName: '2014-04-01-12-30-45-123_photo.jpg',
    precision: 'full',
    parts: { year: 2014, month: 4, day: 1, hour: 12, minute: 30, second: 45 },
  },
  {
    fileName: '20140401_123456_r.jpg',
    precision: 'full',
    parts: { year: 2014, month: 4, day: 1, hour: 12, minute: 34, second: 56 },
  },
  {
    fileName: 'Screenshot_2024-05-01-12-34-56.png',
    precision: 'full',
    parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 34, second: 56 },
  },
  {
    fileName: 'zb2014-04-01_12-34-56.jpg',
    precision: 'full',
    parts: { year: 2014, month: 4, day: 1, hour: 12, minute: 34, second: 56 },
  },
  // 実データで見つかった、年が 2 桁の形(2000 年代として読む)
  {
    fileName: '15-09-06-15-48-35-995_photo.jpg',
    precision: 'full',
    parts: { year: 2015, month: 9, day: 6, hour: 15, minute: 48, second: 35 },
  },
  {
    fileName: '16-12-12-19-48-13-708_deco (1).jpg',
    precision: 'full',
    parts: { year: 2016, month: 12, day: 12, hour: 19, minute: 48, second: 13 },
  },
];

describe('parseFilenameDate: 仕様書の表の例', () => {
  for (const { fileName, precision, parts } of FOUND_CASES) {
    test(fileName, () => {
      const result = parseFilenameDate(fileName, OPTIONS);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.parts).toEqual(parts);
        expect(precisionOf(result.parts)).toBe(precision);
      }
    });
  }
});

describe('parseFilenameDate: 13 桁のエポックミリ秒', () => {
  // 1400000000 秒 = 2014-05-13 16:53:20 UTC
  test('日本時間に変換する(接頭辞つきも読める)', () => {
    for (const fileName of ['1400000000000.jpg', 'line_1400000000000.jpg']) {
      const result = parseFilenameDate(fileName, OPTIONS);
      expect(result).toEqual({
        kind: 'found',
        pattern: 'epoch-millis',
        parts: {
          year: 2014,
          month: 5,
          day: 14,
          hour: 1,
          minute: 53,
          second: 20,
        },
      });
    }
  });

  test('タイムゾーンが違えば、変換後の日時も変わる', () => {
    const result = parseFilenameDate('1400000000000.jpg', {
      ...OPTIONS,
      timeZone: 'America/Los_Angeles',
    });
    expect(result.kind === 'found' && result.parts).toEqual({
      year: 2014,
      month: 5,
      day: 13,
      hour: 9,
      minute: 53,
      second: 20,
    });
  });

  test('範囲外(2000 年より前、未来)は、ただの番号', () => {
    expect(parseFilenameDate('9999999999999.jpg', OPTIONS).kind).toBe('none');
    expect(parseFilenameDate('0000000000001.jpg', OPTIONS).kind).toBe('none');
  });
});

describe('parseFilenameDate: 取れない・無効', () => {
  test('連番だけの名前は、取れない', () => {
    for (const fileName of ['IMG_0001.jpg', 'DSC_0001.JPG', 'IMG_1234.jpg']) {
      expect(parseFilenameDate(fileName, OPTIONS).kind).toBe('none');
    }
  });

  test('存在しない日付は、無効', () => {
    expect(parseFilenameDate('IMG_20240230.jpg', OPTIONS).kind).toBe('invalid');
    expect(parseFilenameDate('IMG_20241301_123456.jpg', OPTIONS).kind).toBe(
      'invalid'
    );
    expect(parseFilenameDate('IMG_20240501_256100.jpg', OPTIONS).kind).toBe(
      'invalid'
    );
    expect(
      parseFilenameDate('15-13-40-15-48-35-995_photo.jpg', OPTIONS).kind
    ).toBe('invalid');
  });

  test('桁が足りない並びは、読まない', () => {
    expect(parseFilenameDate('15-09-06_15.jpg', OPTIONS).kind).toBe('none');
  });
});
