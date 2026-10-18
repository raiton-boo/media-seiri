import { describe, expect, test } from 'bun:test';
import { describeDate, describePlace, placeValue } from './album-search';

describe('album-search', () => {
  test('日付の札', () => {
    expect(describeDate('2014')).toBe('2014年');
    expect(describeDate('2014-04')).toBe('2014年4月');
    expect(describeDate('2014-04-12')).toBe('2014年4月12日');
  });
  test('場所は、座標の近く(南緯・西経も)', () => {
    expect(describePlace('35.7:139.7')).toBe('北緯35.7° 東経139.7° 付近');
    expect(describePlace('-33.9:-70.6')).toBe('南緯33.9° 西経70.6° 付近');
    expect(placeValue({ lat: 35.7, lon: 139.7 })).toBe('35.7:139.7');
  });
});
