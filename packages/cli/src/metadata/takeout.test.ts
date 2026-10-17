import { describe, expect, test } from 'bun:test';
import {
  findTakeoutJson,
  parseTakeoutJson,
  takeoutJsonCandidates,
} from './takeout.ts';

describe('takeoutJsonCandidates', () => {
  test('通常: .json と .supplemental-metadata.json', () => {
    expect(takeoutJsonCandidates('IMG_1234.jpg')).toEqual([
      'IMG_1234.jpg.json',
      'IMG_1234.jpg.supplemental-metadata.json',
    ]);
  });

  test('重複の番号 (1): 番号は、拡張子のあと', () => {
    expect(takeoutJsonCandidates('IMG_1234(1).jpg')).toEqual([
      'IMG_1234.jpg(1).json',
      'IMG_1234.jpg.supplemental-metadata(1).json',
    ]);
  });

  test('編集済み: 元の写真の json', () => {
    expect(takeoutJsonCandidates('IMG_1234-edited.jpg')[0]).toBe(
      'IMG_1234.jpg.json'
    );
    expect(takeoutJsonCandidates('IMG_1234-EDITED.JPG')[0]).toBe(
      'IMG_1234.JPG.json'
    );
  });

  test('拡張子がない名前・ドットを含む名前', () => {
    expect(takeoutJsonCandidates('noext')[0]).toBe('noext.json');
    expect(takeoutJsonCandidates('a.b.c.jpg')[0]).toBe('a.b.c.jpg.json');
  });
});

describe('findTakeoutJson', () => {
  test('同じフォルダの名前から、見つける(大文字小文字は、区別しない)。実際の名前を返す', () => {
    const siblings = ['IMG_1234.JPG', 'img_1234.jpg.JSON', 'other.jpg'];
    expect(findTakeoutJson('IMG_1234.JPG', siblings)).toBe('img_1234.jpg.JSON');
  });

  test('1 つ目の候補を優先する', () => {
    const siblings = new Set([
      'a.jpg.supplemental-metadata.json',
      'a.jpg.json',
    ]);
    expect(findTakeoutJson('a.jpg', siblings)).toBe('a.jpg.json');
    expect(findTakeoutJson('a.jpg', ['a.jpg.supplemental-metadata.json'])).toBe(
      'a.jpg.supplemental-metadata.json'
    );
  });

  test('なければ undefined', () => {
    expect(findTakeoutJson('a.jpg', ['b.jpg.json'])).toBeUndefined();
    expect(findTakeoutJson('a.jpg', [])).toBeUndefined();
  });
});

describe('parseTakeoutJson', () => {
  test('撮影日時(文字列のエポック秒)と位置を読む', () => {
    expect(
      parseTakeoutJson(
        JSON.stringify({
          title: 'a.jpg',
          photoTakenTime: { timestamp: '1709600523', formatted: 'x' },
          geoData: { latitude: 35.68, longitude: 139.76, altitude: 12.5 },
        })
      )
    ).toEqual({
      photoTakenEpochSeconds: 1709600523,
      gpsLat: 35.68,
      gpsLon: 139.76,
      gpsAlt: 12.5,
    });
  });

  test('数値のタイムスタンプも読む', () => {
    expect(
      parseTakeoutJson('{"photoTakenTime":{"timestamp":1709600523}}')
        .photoTakenEpochSeconds
    ).toBe(1709600523);
  });

  test('位置がない(0, 0)ときは、位置を入れない', () => {
    expect(
      parseTakeoutJson(
        '{"photoTakenTime":{"timestamp":"1709600523"},"geoData":{"latitude":0,"longitude":0,"altitude":0}}'
      )
    ).toEqual({ photoTakenEpochSeconds: 1709600523 });
  });

  test('範囲外の位置・不正な時刻は、入れない', () => {
    expect(
      parseTakeoutJson('{"geoData":{"latitude":95,"longitude":10}}')
    ).toEqual({});
    for (const timestamp of ['abc', '0', '-5', '1.5', '']) {
      expect(
        parseTakeoutJson(JSON.stringify({ photoTakenTime: { timestamp } }))
      ).toEqual({});
    }
  });

  test('JSON でない・形が違うときは、空の結果(例外にしない)', () => {
    for (const text of [
      'not json',
      '',
      '[]',
      'null',
      '"x"',
      '{"photoTakenTime":5}',
    ]) {
      expect(parseTakeoutJson(text)).toEqual({});
    }
  });
});
