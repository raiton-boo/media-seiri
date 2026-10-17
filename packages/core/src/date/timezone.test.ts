import { describe, expect, test } from 'bun:test';
import { epochToLocalParts, utcPartsToLocalParts } from './timezone.ts';

describe('utcPartsToLocalParts(動画の CreateDate は UTC)', () => {
  test('日本時間は、UTC の 9 時間後', () => {
    expect(
      utcPartsToLocalParts(
        { year: 2014, month: 4, day: 6, hour: 6, minute: 32, second: 3 },
        'Asia/Tokyo'
      )
    ).toEqual({
      year: 2014,
      month: 4,
      day: 6,
      hour: 15,
      minute: 32,
      second: 3,
    });
  });

  test('変換後のローカル時刻で、日付が決まる(日付をまたぐ)', () => {
    expect(
      utcPartsToLocalParts(
        { year: 2014, month: 4, day: 5, hour: 16, minute: 0, second: 0 },
        'Asia/Tokyo'
      )
    ).toEqual({
      year: 2014,
      month: 4,
      day: 6,
      hour: 1,
      minute: 0,
      second: 0,
    });
  });

  test('0 時は「24」にならない', () => {
    const local = utcPartsToLocalParts(
      { year: 2014, month: 4, day: 5, hour: 15, minute: 0, second: 0 },
      'Asia/Tokyo'
    );
    expect(local.hour).toBe(0);
    expect(local.day).toBe(6);
  });

  test('夏時間(サマータイム)も、考慮する', () => {
    // ロサンゼルスの夏は UTC-7
    const summer = utcPartsToLocalParts(
      { year: 2014, month: 7, day: 1, hour: 12, minute: 0, second: 0 },
      'America/Los_Angeles'
    );
    expect(summer.hour).toBe(5);
    // 冬は UTC-8
    const winter = utcPartsToLocalParts(
      { year: 2014, month: 1, day: 1, hour: 12, minute: 0, second: 0 },
      'America/Los_Angeles'
    );
    expect(winter.hour).toBe(4);
  });
});

describe('epochToLocalParts', () => {
  test('UNIX のミリ秒を、日本時間の日時にする', () => {
    // 0 = 1970-01-01 00:00:00 UTC
    expect(epochToLocalParts(0, 'Asia/Tokyo')).toEqual({
      year: 1970,
      month: 1,
      day: 1,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });
});
