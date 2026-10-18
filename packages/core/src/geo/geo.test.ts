import { describe, expect, test } from 'bun:test';
import {
  areaLabel,
  areaRefsOf,
  cityLabel,
  countryName,
  describeNearest,
  distanceBetweenKm,
  getCity,
  nearestCity,
  searchAreas,
} from './index.ts';

describe('nearestCity', () => {
  test('日本: 浅草の近く → 浅草区(市区町村の名前を選ぶ)。東京都・日本の指定も付く', () => {
    const city = nearestCity(35.7148, 139.7967);
    expect(city?.ja).toBe('浅草区');
    expect(areaRefsOf(city as NonNullable<typeof city>)).toEqual([
      `city:${city?.id}`,
      'pref:40',
      'country:JP',
    ]);
    expect(describeNearest(35.7148, 139.7967)).toBe('浅草区(東京都) 付近');
    expect(nearestCity(35.658, 139.7016)?.ja).toBe('渋谷区');
    expect(nearestCity(34.9949, 135.785)?.ja).toBe('京都市');
  });

  test('海外: 近い範囲で人口の多い地名(パリ)。日本語名(カタカナ)と国名', () => {
    const paris = nearestCity(48.8584, 2.2945);
    expect(paris?.ja).toBe('パリ');
    expect(cityLabel(paris as NonNullable<typeof paris>)).toBe(
      'パリ(フランス)'
    );
  });

  test('遠すぎる場所(太平洋の真ん中)・不正な値は、なし', () => {
    expect(nearestCity(-40, -140)).toBeUndefined();
    expect(nearestCity(Number.NaN, 0)).toBeUndefined();
  });

  test('経度が 180 度をまたぐ近くでも、探せる', () => {
    expect(nearestCity(-17.7, 177.4)?.cc).toBe('FJ');
  });
});

describe('searchAreas', () => {
  test('国・都道府県・地名(日本語)', () => {
    const refs = searchAreas('東京');
    expect(refs).toContain('pref:40');
    expect(searchAreas('日本')).toContain('country:JP');
    expect(searchAreas('台東').map((ref) => areaLabel(ref))).toContain(
      '台東区(東京都)'
    );
    expect(getCity(1850147)?.ja).toBe('東京');
  });

  test('英語(2 文字以上)。1 文字の英語は、探さない。空は、なし', () => {
    expect(
      searchAreas('kyoto').some((ref) => areaLabel(ref)?.startsWith('京都市'))
    ).toBe(true);
    expect(searchAreas('k')).toEqual([]);
    expect(searchAreas('  ')).toEqual([]);
  });

  test('全角・大文字小文字は、そろえる。件数の上限', () => {
    expect(searchAreas('ＫＹＯＴＯ').length).toBeGreaterThan(0);
    expect(searchAreas('a', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('表示', () => {
  test('地域の指定の表示。知らない指定は、undefined', () => {
    expect(areaLabel('pref:40')).toBe('東京都');
    expect(areaLabel('country:JP')).toBe('日本');
    expect(areaLabel('country:XX')).toBeDefined();
    expect(areaLabel('city:0')).toBeUndefined();
    expect(areaLabel('zzz:1')).toBeUndefined();
    expect(areaLabel('pref:99')).toBeUndefined();
    expect(getCity(-1)).toBeUndefined();
    expect(countryName('FR')).toBe('フランス');
  });

  test('距離(東京-大阪は、約 400km)', () => {
    const km = distanceBetweenKm(35.68, 139.77, 34.69, 135.5);
    expect(km).toBeGreaterThan(390);
    expect(km).toBeLessThan(410);
  });
});
