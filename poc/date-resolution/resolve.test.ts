import { describe, expect, test } from 'bun:test';
import { type DateParts, parseFilenameDate, resolveDate } from './resolve.ts';

// 13 桁のエポックミリ秒の検査で使う「現在」。実行日に左右されないよう固定する
const NOW = new Date(2026, 9, 18);

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
];

/** 実データで見つかった、年が 2 桁の形(仕様書の表にはない。PoC で追加) */
const TWO_DIGIT_YEAR_CASES = [
  '15-09-06-15-48-35-995_photo.jpg',
  '16-12-12-19-48-13-708_deco.jpg',
  '16-12-12-19-48-13-708_deco (1).jpg',
];

describe('parseFilenameDate: 年が 2 桁の形', () => {
  for (const fileName of TWO_DIGIT_YEAR_CASES) {
    test(fileName, () => {
      const result = parseFilenameDate(fileName, NOW);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.precision).toBe('full');
        expect(result.parts.year).toBeGreaterThanOrEqual(2015);
        expect(result.parts.second).toBeDefined();
      }
    });
  }

  test('存在しない日付は、無効', () => {
    expect(parseFilenameDate('15-13-40-15-48-35-995_photo.jpg', NOW).kind).toBe(
      'invalid'
    );
  });

  test('桁が足りない連番のような並びは、読まない', () => {
    expect(parseFilenameDate('15-09-06_15.jpg', NOW).kind).toBe('none');
  });
});

describe('parseFilenameDate: 仕様書の表の例', () => {
  for (const { fileName, precision, parts } of FOUND_CASES) {
    test(fileName, () => {
      const result = parseFilenameDate(fileName, NOW);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.precision).toBe(precision);
        expect(result.parts).toEqual(parts);
      }
    });
  }

  test('13 桁のエポックミリ秒(接頭辞つきも読める)', () => {
    for (const fileName of ['1400000000000.jpg', 'line_1400000000000.jpg']) {
      const result = parseFilenameDate(fileName, NOW);
      expect(result.kind).toBe('found');
      if (result.kind === 'found') {
        expect(result.precision).toBe('full');
        const expected = new Date(1400000000000);
        expect(result.parts.year).toBe(expected.getFullYear());
        expect(result.parts.hour).toBe(expected.getHours());
      }
    }
  });
});

describe('parseFilenameDate: 取れない・無効', () => {
  test('連番だけの名前は、取れない', () => {
    for (const fileName of ['IMG_0001.jpg', 'DSC_0001.JPG', 'IMG_1234.jpg']) {
      expect(parseFilenameDate(fileName, NOW).kind).toBe('none');
    }
  });

  test('範囲外の 13 桁は、ただの番号(取れない)', () => {
    expect(parseFilenameDate('9999999999999.jpg', NOW).kind).toBe('none');
    expect(parseFilenameDate('0000000000001.jpg', NOW).kind).toBe('none');
  });

  test('存在しない日付は、無効', () => {
    expect(parseFilenameDate('IMG_20240230.jpg', NOW).kind).toBe('invalid');
    expect(parseFilenameDate('IMG_20241301_123456.jpg', NOW).kind).toBe(
      'invalid'
    );
    expect(parseFilenameDate('IMG_20240501_256100.jpg', NOW).kind).toBe(
      'invalid'
    );
  });
});

describe('resolveDate: 優先順位', () => {
  const metadata = {
    kind: 'found',
    precision: 'full',
    parts: { year: 2014, month: 4, day: 6, hour: 15, minute: 32, second: 3 },
  } as const;

  test('メタデータがあれば、ファイル名より優先する', () => {
    const result = resolveDate(metadata, 'IMG_20200101_000000.jpg', NOW);
    expect(result.source).toBe('metadata');
    expect(result.parts?.year).toBe(2014);
  });

  test('メタデータがなければ、ファイル名を使う(フォールバック)', () => {
    const result = resolveDate(
      { kind: 'none' },
      'IMG_20200101_000000.jpg',
      NOW
    );
    expect(result.source).toBe('filename');
    expect(result.precision).toBe('full');
  });

  test('どこからも取れなければ none', () => {
    expect(resolveDate({ kind: 'none' }, 'IMG_0001.jpg', NOW)).toEqual({
      source: 'none',
      precision: 'none',
    });
  });

  test('メタデータが不正で、ファイル名からも取れなければ invalid', () => {
    expect(resolveDate({ kind: 'invalid' }, 'IMG_0001.jpg', NOW)).toEqual({
      source: 'none',
      precision: 'invalid',
    });
  });

  test('メタデータが不正でも、ファイル名から取れれば、ファイル名を使う', () => {
    const result = resolveDate({ kind: 'invalid' }, '20140401.jpg', NOW);
    expect(result.source).toBe('filename');
    expect(result.precision).toBe('date');
  });
});
