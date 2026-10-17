import { describe, expect, test } from 'bun:test';
import { ExifDate, ExifDateTime, type Tags } from 'exiftool-vendored';
import { extractMetadata } from './tags.ts';

/** タグの値(ExifTool が返す形)を、手で作る。`tzoffsetMinutes` があれば、時刻のずれを含む日時 */
const dateTime = (
  parts: [number, number, number, number, number, number],
  tzoffsetMinutes?: number
): ExifDateTime =>
  new ExifDateTime(
    ...parts,
    undefined,
    tzoffsetMinutes,
    undefined,
    tzoffsetMinutes === undefined ? undefined : 'zone'
  );

const asTags = (tags: Record<string, unknown>): Tags => tags as Tags;

describe('写真・RAW の日付', () => {
  test('DateTimeOriginal と CreateDate を、書かれた部品のまま読む', () => {
    const { dates } = extractMetadata(
      asTags({
        DateTimeOriginal: dateTime([2024, 3, 5, 10, 20, 30]),
        CreateDate: dateTime([2024, 3, 5, 10, 20, 31]),
      }),
      false
    );
    expect(dates).toEqual({
      exif: {
        dateTimeOriginal: {
          kind: 'value',
          parts: {
            year: 2024,
            month: 3,
            day: 5,
            hour: 10,
            minute: 20,
            second: 30,
          },
        },
        createDate: {
          kind: 'value',
          parts: {
            year: 2024,
            month: 3,
            day: 5,
            hour: 10,
            minute: 20,
            second: 31,
          },
        },
      },
    });
  });

  test('オフセットつきは、撮影地の時刻(書かれた部品)のまま。UTC に直さない', () => {
    const { dates } = extractMetadata(
      asTags({ DateTimeOriginal: dateTime([2024, 3, 5, 10, 20, 30], 540) }),
      false
    );
    expect(dates.exif?.dateTimeOriginal).toEqual({
      kind: 'value',
      parts: { year: 2024, month: 3, day: 5, hour: 10, minute: 20, second: 30 },
    });
  });

  test('日付だけ(ExifDate)は、年月日だけの部品', () => {
    const { dates } = extractMetadata(
      asTags({ CreateDate: new ExifDate(2024, 3, 5) }),
      false
    );
    expect(dates.exif?.createDate).toEqual({
      kind: 'value',
      parts: { year: 2024, month: 3, day: 5 },
    });
  });

  test('解釈できなかった値(文字列・数値)は、unparsable', () => {
    const { dates } = extractMetadata(
      asTags({ DateTimeOriginal: '0000:00:00 00:00:00', CreateDate: 0 }),
      false
    );
    expect(dates).toEqual({
      exif: {
        dateTimeOriginal: { kind: 'unparsable' },
        createDate: { kind: 'unparsable' },
      },
    });
  });

  test('タグがなければ、日付はなし(片方だけなら、その分だけ)', () => {
    expect(extractMetadata(asTags({}), false).dates).toEqual({});
    expect(
      extractMetadata(
        asTags({ CreateDate: dateTime([2024, 1, 1, 0, 0, 0]) }),
        false
      ).dates.exif
    ).toEqual({
      createDate: {
        kind: 'value',
        parts: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      },
    });
  });

  test('写真では、動画の日付のタグ(MediaCreateDate)を使わない', () => {
    expect(
      extractMetadata(
        asTags({ MediaCreateDate: dateTime([2024, 1, 1, 0, 0, 0], 0) }),
        false
      ).dates
    ).toEqual({});
  });
});

describe('動画の日付', () => {
  const INSTANT = {
    year: 2024,
    month: 3,
    day: 5,
    hour: 1,
    minute: 2,
    second: 3,
  };

  test('時刻のずれを含む日時は、UTC の瞬間から、UTC の部品を作る(本機のタイムゾーンに、左右されない)', () => {
    // 同じ瞬間(2024-03-05T01:02:03Z)を、UTC・東京・ニューヨークの部品で表したもの
    for (const value of [
      dateTime([2024, 3, 5, 1, 2, 3], 0),
      dateTime([2024, 3, 5, 10, 2, 3], 540),
      dateTime([2024, 3, 4, 20, 2, 3], -300),
    ]) {
      const { dates } = extractMetadata(asTags({ CreateDate: value }), true);
      expect(dates).toEqual({
        videoCreateDateUtc: { kind: 'value', parts: INSTANT },
      });
    }
  });

  test('CreateDate → MediaCreateDate → TrackCreateDate → DateTimeOriginal の順に読む', () => {
    const utc = (hour: number) => dateTime([2024, 3, 5, hour, 0, 0], 0);
    const pick = (tags: Record<string, unknown>) => {
      const parts = extractMetadata(asTags(tags), true).dates
        .videoCreateDateUtc;
      return parts?.kind === 'value' ? parts.parts.hour : undefined;
    };
    expect(
      pick({
        CreateDate: utc(1),
        MediaCreateDate: utc(2),
        TrackCreateDate: utc(3),
        DateTimeOriginal: utc(4),
      })
    ).toBe(1);
    expect(
      pick({
        MediaCreateDate: utc(2),
        TrackCreateDate: utc(3),
        DateTimeOriginal: utc(4),
      })
    ).toBe(2);
    expect(pick({ TrackCreateDate: utc(3), DateTimeOriginal: utc(4) })).toBe(3);
    expect(pick({ DateTimeOriginal: utc(4) })).toBe(4);
  });

  test('解釈できないタグは飛ばして、次のタグを使う', () => {
    const { dates } = extractMetadata(
      asTags({
        CreateDate: '0000:00:00 00:00:00',
        MediaCreateDate: dateTime([2024, 3, 5, 1, 2, 3], 0),
      }),
      true
    );
    expect(dates.videoCreateDateUtc).toEqual({ kind: 'value', parts: INSTANT });
  });

  test('すべて解釈できなければ、videoCreateDateUtc は unparsable', () => {
    const { dates } = extractMetadata(
      asTags({
        CreateDate: '0000:00:00 00:00:00',
        MediaCreateDate: '0000:00:00 00:00:00',
      }),
      true
    );
    expect(dates).toEqual({ videoCreateDateUtc: { kind: 'unparsable' } });
  });

  test('時刻のずれのない日時は、UTC とは言えないため、ローカル時刻(exif.createDate)として渡す', () => {
    const { dates } = extractMetadata(
      asTags({ CreateDate: dateTime([2024, 3, 5, 10, 20, 30]) }),
      true
    );
    expect(dates).toEqual({
      exif: {
        createDate: {
          kind: 'value',
          parts: {
            year: 2024,
            month: 3,
            day: 5,
            hour: 10,
            minute: 20,
            second: 30,
          },
        },
      },
    });
    expect(dates.videoCreateDateUtc).toBeUndefined();
  });

  test('日付のタグがなければ、日付はなし', () => {
    expect(extractMetadata(asTags({ Duration: 3 }), true).dates).toEqual({});
  });
});

describe('日付以外の項目', () => {
  test('カメラ・レンズ・寸法・長さ・GPS を取り出す(前後の空白は、除く)', () => {
    const { details } = extractMetadata(
      asTags({
        Make: ' Canon ',
        Model: 'EOS R6',
        LensModel: 'RF 24-70mm',
        ImageWidth: 6000,
        ImageHeight: 4000,
        Duration: 12.5,
        GPSLatitude: 35.68,
        GPSLongitude: 139.76,
        GPSAltitude: 12.5,
      }),
      false
    );
    expect(details).toEqual({
      cameraMake: 'Canon',
      cameraModel: 'EOS R6',
      lensModel: 'RF 24-70mm',
      width: 6000,
      height: 4000,
      durationSec: 12.5,
      gpsLat: 35.68,
      gpsLon: 139.76,
      gpsAlt: 12.5,
    });
  });

  test('ないものは、キーごと省く(undefined を入れない)', () => {
    expect(extractMetadata(asTags({ Make: 'X' }), false).details).toEqual({
      cameraMake: 'X',
    });
    expect(Object.keys(extractMetadata(asTags({}), false).details)).toEqual([]);
  });

  test('レンズは、LensModel がなければ Lens', () => {
    expect(
      extractMetadata(asTags({ Lens: '50mm' }), false).details.lensModel
    ).toBe('50mm');
    expect(
      extractMetadata(asTags({ LensModel: 'A', Lens: 'B' }), false).details
        .lensModel
    ).toBe('A');
  });

  test('空の文字列・文字列でない値は、ないものとする', () => {
    expect(
      extractMetadata(asTags({ Make: '  ', Model: 5, LensModel: '' }), false)
        .details
    ).toEqual({});
  });

  test('台帳の制約に合わない値は、捨てる(負の寸法・長さ、数でない値)', () => {
    const { details } = extractMetadata(
      asTags({ ImageWidth: -1, ImageHeight: Number.NaN, Duration: -0.5 }),
      false
    );
    expect(details).toEqual({});
  });

  test('寸法は、整数にする', () => {
    expect(
      extractMetadata(asTags({ ImageWidth: 100.9, ImageHeight: 50 }), false)
        .details
    ).toEqual({
      width: 100,
      height: 50,
    });
  });

  test('GPS: 範囲外・片方だけ・緯度経度がどちらも 0 は、捨てる', () => {
    for (const tags of [
      { GPSLatitude: 91, GPSLongitude: 10 },
      { GPSLatitude: 10, GPSLongitude: 181 },
      { GPSLatitude: -90.1, GPSLongitude: 0 },
      { GPSLatitude: 10 },
      { GPSLongitude: 10 },
      { GPSLatitude: 0, GPSLongitude: 0, GPSAltitude: 5 },
      { GPSLatitude: Number.NaN, GPSLongitude: 1 },
    ]) {
      expect(extractMetadata(asTags(tags), false).details).toEqual({});
    }
  });

  test('GPS: 境界の値と、片方だけが 0 の値は、採用する。高度は、なくてもよい', () => {
    expect(
      extractMetadata(asTags({ GPSLatitude: 90, GPSLongitude: -180 }), false)
        .details
    ).toEqual({
      gpsLat: 90,
      gpsLon: -180,
    });
    expect(
      extractMetadata(asTags({ GPSLatitude: 0, GPSLongitude: 139.7 }), false)
        .details
    ).toEqual({
      gpsLat: 0,
      gpsLon: 139.7,
    });
  });

  test('警告は、そのまま持ち回る(破損の検出に使う)', () => {
    expect(
      extractMetadata(asTags({ Warning: 'Truncated image' }), false).warning
    ).toBe('Truncated image');
    expect('warning' in extractMetadata(asTags({}), false)).toBe(false);
  });
});
