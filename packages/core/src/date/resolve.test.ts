import { describe, expect, test } from 'bun:test';
import { resolveDate } from './resolve.ts';
import type { DateOptions, DateParts, RawDateTime } from './types.ts';

// 2026-10-18 03:00 JST
const OPTIONS: DateOptions = {
  now: new Date('2026-10-18T03:00:00+09:00'),
  timeZone: 'Asia/Tokyo',
};

const value = (parts: DateParts): RawDateTime => ({ kind: 'value', parts });
const UNPARSABLE: RawDateTime = { kind: 'unparsable' };
const FULL_2014 = {
  year: 2014,
  month: 4,
  day: 6,
  hour: 15,
  minute: 32,
  second: 3,
};

describe('resolveDate: 優先順位(仕様書 §3-1)', () => {
  test('EXIF の DateTimeOriginal が、最優先(ファイル名より優先)', () => {
    const result = resolveDate(
      {
        fileName: 'IMG_20200101_000000.jpg',
        exif: { dateTimeOriginal: value(FULL_2014) },
      },
      OPTIONS
    );
    expect(result).toMatchObject({
      source: 'exif',
      precision: 'full',
      parts: FULL_2014,
      reason: '',
    });
  });

  test('DateTimeOriginal がなければ、DateTimeDigitized、CreateDate の順に試す', () => {
    const digitized = resolveDate(
      {
        fileName: 'a.jpg',
        exif: {
          dateTimeDigitized: value({ ...FULL_2014, hour: 1 }),
          createDate: value({ ...FULL_2014, hour: 2 }),
        },
      },
      OPTIONS
    );
    expect(digitized.parts?.hour).toBe(1);
    const createOnly = resolveDate(
      {
        fileName: 'a.jpg',
        exif: { createDate: value({ ...FULL_2014, hour: 2 }) },
      },
      OPTIONS
    );
    expect(createOnly).toMatchObject({ source: 'exif', parts: { hour: 2 } });
  });

  test('DateTimeOriginal が無効なら、次の DateTimeDigitized に進む(本体のメタデータなので、通常扱い)', () => {
    const result = resolveDate(
      {
        fileName: 'a.jpg',
        exif: {
          dateTimeOriginal: UNPARSABLE,
          dateTimeDigitized: value(FULL_2014),
        },
      },
      OPTIONS
    );
    expect(result).toMatchObject({
      source: 'exif',
      precision: 'full',
      reason: '',
    });
  });

  test('動画の CreateDate は UTC なので、日本時間に変換する', () => {
    const result = resolveDate(
      {
        fileName: 'MOV_0001.MP4',
        videoCreateDateUtc: value({
          year: 2014,
          month: 4,
          day: 6,
          hour: 6,
          minute: 32,
          second: 3,
        }),
      },
      OPTIONS
    );
    expect(result).toMatchObject({
      source: 'video',
      precision: 'full',
      parts: FULL_2014,
      reason: '',
    });
  });

  test('動画の UTC が、変換後に、日付をまたぐときは、ローカル時刻の日付になる', () => {
    const result = resolveDate(
      {
        fileName: 'MOV_0001.MP4',
        videoCreateDateUtc: value({
          year: 2014,
          month: 4,
          day: 5,
          hour: 16,
          minute: 0,
          second: 0,
        }),
      },
      OPTIONS
    );
    expect(result.parts).toMatchObject({
      year: 2014,
      month: 4,
      day: 6,
      hour: 1,
    });
  });

  test('本体のメタデータがなければ、Takeout の json を使う(フォールバック)', () => {
    // 1400000000 秒 = 2014-05-13 16:53:20 UTC = 2014-05-14 01:53:20 JST
    const result = resolveDate(
      { fileName: 'IMG_0001.jpg', takeoutPhotoTakenEpochSeconds: 1400000000 },
      OPTIONS
    );
    expect(result).toMatchObject({
      source: 'json',
      precision: 'full',
      parts: { year: 2014, month: 5, day: 14, hour: 1, minute: 53, second: 20 },
    });
    expect(result.reason).toContain('Takeout の json');
  });

  test('json もなければ、ファイル名を使う(フォールバック)', () => {
    const result = resolveDate({ fileName: '20140401_123456_r.jpg' }, OPTIONS);
    expect(result).toMatchObject({
      source: 'filename',
      precision: 'full',
      filenamePattern: 'date-time',
    });
    expect(result.reason).toContain('本体のメタデータに撮影日時がなかったため');
    expect(result.reason).toContain('date-time');
  });

  test('json は、ファイル名より優先する', () => {
    const result = resolveDate(
      {
        fileName: '20200101_000000.jpg',
        takeoutPhotoTakenEpochSeconds: 1400000000,
      },
      OPTIONS
    );
    expect(result.source).toBe('json');
  });

  test('ファイル名の精度が、そのまま精度になる(date・month)', () => {
    expect(resolveDate({ fileName: '20240501.jpg' }, OPTIONS)).toMatchObject({
      source: 'filename',
      precision: 'date',
    });
    expect(resolveDate({ fileName: '2024-05.jpg' }, OPTIONS)).toMatchObject({
      source: 'filename',
      precision: 'month',
    });
  });
});

describe('resolveDate: mtime は採用しない', () => {
  test('mtime しかないときは、日付なし(参考として、結果に残す)', () => {
    const mtime = new Date('2021-03-04T00:00:00Z');
    const result = resolveDate({ fileName: 'IMG_0001.JPG', mtime }, OPTIONS);
    expect(result).toMatchObject({
      source: 'none',
      precision: 'none',
      parts: undefined,
    });
    expect(result.referenceMtime).toBe(mtime);
  });

  test('日付が取れたときも、mtime は、参考として残るだけ', () => {
    const mtime = new Date('2021-03-04T00:00:00Z');
    const result = resolveDate(
      {
        fileName: 'a.jpg',
        exif: { dateTimeOriginal: value(FULL_2014) },
        mtime,
      },
      OPTIONS
    );
    expect(result.parts).toEqual(FULL_2014);
    expect(result.referenceMtime).toBe(mtime);
  });
});

describe('resolveDate: 無効な値は、次の取得元へ進む(仕様書 §3-3)', () => {
  test('EXIF が無効で、ファイル名が有効なら、ファイル名を使い、理由に「無効だった」と残す', () => {
    const result = resolveDate(
      { fileName: '20140401.jpg', exif: { dateTimeOriginal: UNPARSABLE } },
      OPTIONS
    );
    expect(result).toMatchObject({ source: 'filename', precision: 'date' });
    expect(result.reason).toContain('本体の日時の値が無効だったため');
  });

  test('1970 年より前の EXIF は、無効', () => {
    const result = resolveDate(
      {
        fileName: 'IMG_0001.jpg',
        exif: {
          dateTimeOriginal: value({
            year: 1969,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
          }),
        },
      },
      OPTIONS
    );
    expect(result).toMatchObject({ source: 'none', precision: 'invalid' });
  });

  test('未来の EXIF は、無効', () => {
    const result = resolveDate(
      {
        fileName: 'IMG_0001.jpg',
        exif: {
          dateTimeOriginal: value({
            year: 2030,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
          }),
        },
      },
      OPTIONS
    );
    expect(result.precision).toBe('invalid');
  });

  test('0000:00:00 のような値だけなら、invalid', () => {
    const result = resolveDate(
      { fileName: 'DSC_9999.JPG', exif: { dateTimeOriginal: UNPARSABLE } },
      OPTIONS
    );
    expect(result).toMatchObject({
      source: 'none',
      precision: 'invalid',
      parts: undefined,
    });
    expect(result.reason).toContain('無効');
  });

  test('ファイル名の日付が存在しない日付なら、invalid(IMG_20240230)', () => {
    expect(
      resolveDate({ fileName: 'IMG_20240230.jpg' }, OPTIONS).precision
    ).toBe('invalid');
  });

  test('ファイル名の日付が未来なら、invalid', () => {
    expect(
      resolveDate({ fileName: 'IMG_20301231_235959.jpg' }, OPTIONS).precision
    ).toBe('invalid');
  });

  test('どこからも取れなければ、none', () => {
    const result = resolveDate({ fileName: 'IMG_0001.jpg' }, OPTIONS);
    expect(result).toMatchObject({
      source: 'none',
      precision: 'none',
      parts: undefined,
    });
    expect(result.reason).toContain('どれからも');
  });
});
