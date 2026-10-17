import { describe, expect, test } from 'bun:test';
import { resolveDate } from '../date/index.ts';
import {
  buildPlacement,
  type PlacementTarget,
  targetFromResolution,
} from './placement.ts';

const FULL: PlacementTarget = {
  kind: 'dated',
  precision: 'full',
  parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 30, second: 45 },
};
const DATE: PlacementTarget = {
  kind: 'dated',
  precision: 'date',
  parts: { year: 2024, month: 5, day: 1 },
};
const MONTH: PlacementTarget = {
  kind: 'dated',
  precision: 'month',
  parts: { year: 2024, month: 5 },
};
const YEAR: PlacementTarget = {
  kind: 'dated',
  precision: 'year',
  parts: { year: 2024 },
};

describe('buildPlacement(仕様書 §2-2 の表)', () => {
  test('年月日+時刻', () => {
    expect(buildPlacement(FULL, 'IMG_0412.JPG')).toEqual({
      bucket: 'full',
      directory: '2024/05',
      fileName: '2024.05.01_12-30-45_IMG_0412.jpg',
    });
  });

  test('年月日のみ', () => {
    expect(buildPlacement(DATE, 'IMG_0001.jpg')).toEqual({
      bucket: 'time_unknown',
      directory: '2024/05/_時刻不明',
      fileName: '2024.05.01_IMG_0001.jpg',
    });
  });

  test('年月のみ', () => {
    expect(buildPlacement(MONTH, 'IMG_0002.jpg')).toEqual({
      bucket: 'date_unknown',
      directory: '2024/05/_日付不明',
      fileName: '2024.05_IMG_0002.jpg',
    });
  });

  test('年のみ', () => {
    expect(buildPlacement(YEAR, 'IMG_0003.jpg')).toEqual({
      bucket: 'md_unknown',
      directory: '2024/_月日不明',
      fileName: '2024_IMG_0003.jpg',
    });
  });

  test('_unknown の 4 つ(日付なし・日付が不正・修復後も日付なし・読み取り不可)', () => {
    const cases = [
      { reason: 'none', bucket: 'unknown_none', folder: '日付なし' },
      { reason: 'invalid', bucket: 'unknown_invalid', folder: '日付が不正' },
      {
        reason: 'repaired-nodate',
        bucket: 'unknown_repaired_nodate',
        folder: '修復後も日付なし',
      },
      {
        reason: 'unreadable',
        bucket: 'unknown_unreadable',
        folder: '読み取り不可',
      },
    ] as const;
    for (const { reason, bucket, folder } of cases) {
      expect(
        buildPlacement({ kind: 'unknown', reason }, 'IMG_0412.JPG')
      ).toEqual({
        bucket,
        directory: `_unknown/${folder}`,
        fileName: 'IMG_0412.jpg',
      });
    }
  });
});

describe('buildPlacement: 名前の整え方', () => {
  test('出力の拡張子は、小文字にそろえる(元の名前の大文字小文字は、残す)', () => {
    expect(buildPlacement(FULL, 'DSC_0001.JPG').fileName).toBe(
      '2024.05.01_12-30-45_DSC_0001.jpg'
    );
    expect(buildPlacement(FULL, 'img_0001.Cr3').fileName).toBe(
      '2024.05.01_12-30-45_img_0001.cr3'
    );
  });

  test('元の名前の、使えない文字は、置き換える', () => {
    expect(buildPlacement(FULL, 'a:b?c.jpg').fileName).toBe(
      '2024.05.01_12-30-45_a_b_c.jpg'
    );
  });

  test('60 文字を超える元の名前は、切る', () => {
    const result = buildPlacement(FULL, `${'x'.repeat(100)}.jpg`);
    expect(result.fileName).toBe(`2024.05.01_12-30-45_${'x'.repeat(60)}.jpg`);
  });

  test('ZIP の中のファイルは、中のファイル名で決める(ZIP のパスは使わない)', () => {
    expect(buildPlacement(FULL, '20140406_153203_r.jpg').fileName).toBe(
      '2024.05.01_12-30-45_20140406_153203_r.jpg'
    );
  });

  test('日付の部分がない `_unknown/` の名前が、Windows の予約名なら、先頭に `_` を付ける', () => {
    expect(
      buildPlacement({ kind: 'unknown', reason: 'none' }, 'CON.jpg').fileName
    ).toBe('_CON.jpg');
  });

  test('年が 4 桁に満たなくても、4 桁にそろえる', () => {
    const result = buildPlacement(
      { kind: 'dated', precision: 'year', parts: { year: 1999 } },
      'a.jpg'
    );
    expect(result.directory).toBe('1999/_月日不明');
  });

  test('拡張子がない名前は、拡張子なしのまま', () => {
    expect(buildPlacement(FULL, 'README').fileName).toBe(
      '2024.05.01_12-30-45_README'
    );
  });

  test('日付の部品が足りないときは、エラー(呼び出しの誤り)', () => {
    expect(() =>
      buildPlacement(
        { kind: 'dated', precision: 'full', parts: { year: 2024, month: 5 } },
        'a.jpg'
      )
    ).toThrow();
  });
});

describe('buildPlacement: 連番', () => {
  test('連番は、名前の最後(拡張子の前)に、2 桁で付ける', () => {
    expect(buildPlacement(DATE, 'IMG_0001.jpg', 1).fileName).toBe(
      '2024.05.01_IMG_0001_01.jpg'
    );
    expect(buildPlacement(DATE, 'IMG_0001.jpg', 2).fileName).toBe(
      '2024.05.01_IMG_0001_02.jpg'
    );
    expect(buildPlacement(FULL, 'IMG_0001.jpg', 15).fileName).toBe(
      '2024.05.01_12-30-45_IMG_0001_15.jpg'
    );
  });

  test('100 以上は、桁を増やす', () => {
    expect(buildPlacement(DATE, 'IMG_0001.jpg', 100).fileName).toBe(
      '2024.05.01_IMG_0001_100.jpg'
    );
  });

  test('連番がなければ、付けない', () => {
    expect(buildPlacement(DATE, 'IMG_0001.jpg').fileName).toBe(
      '2024.05.01_IMG_0001.jpg'
    );
  });
});

describe('targetFromResolution(日付の決定から、置き場所へ)', () => {
  const options = {
    now: new Date('2026-10-18T03:00:00+09:00'),
    timeZone: 'Asia/Tokyo',
  };

  test('日付が取れたものは、精度どおりの置き場所になる', () => {
    const resolution = resolveDate(
      { fileName: '20140401_123456_r.jpg' },
      options
    );
    const placement = buildPlacement(
      targetFromResolution(resolution),
      '20140401_123456_r.jpg'
    );
    expect(placement).toEqual({
      bucket: 'full',
      directory: '2014/04',
      fileName: '2014.04.01_12-34-56_20140401_123456_r.jpg',
    });
  });

  test('ファイル名に年月日だけのものは、_時刻不明 になる', () => {
    const resolution = resolveDate({ fileName: '20140401.jpg' }, options);
    expect(
      buildPlacement(targetFromResolution(resolution), '20140401.jpg')
    ).toMatchObject({
      bucket: 'time_unknown',
      directory: '2014/04/_時刻不明',
    });
  });

  test('日付が取れなかったものは、_unknown/日付なし になる', () => {
    const resolution = resolveDate({ fileName: 'IMG_0001.JPG' }, options);
    expect(
      buildPlacement(targetFromResolution(resolution), 'IMG_0001.JPG')
    ).toEqual({
      bucket: 'unknown_none',
      directory: '_unknown/日付なし',
      fileName: 'IMG_0001.jpg',
    });
  });

  test('日付の値が無効なものは、_unknown/日付が不正 になる', () => {
    const resolution = resolveDate({ fileName: 'IMG_20240230.jpg' }, options);
    expect(
      buildPlacement(targetFromResolution(resolution), 'IMG_20240230.jpg')
        .bucket
    ).toBe('unknown_invalid');
  });
});
