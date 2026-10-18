import { describe, expect, test } from 'bun:test';
import { formatPhotoDate, placeCell, viewKindOf } from './photo';

describe('photo', () => {
  test('ブラウザで表示できる形', () => {
    expect(viewKindOf('2014/a.JPG')).toBe('image');
    expect(viewKindOf('a.mov')).toBe('video');
    expect(viewKindOf('a.heic')).toBeNull();
    expect(viewKindOf('a.cr3')).toBeNull();
    expect(viewKindOf('noext')).toBeNull();
  });
  test('日付の見出し', () => {
    expect(formatPhotoDate('2014-04-06T15:32:03')).toBe(
      '2014年4月6日(日) 15:32'
    );
    expect(formatPhotoDate('2014-04-06')).toBe('2014年4月6日(日)');
    expect(formatPhotoDate('2014')).toBe('2014');
    expect(formatPhotoDate(null)).toBe('日付なし');
  });
  test('場所の格子', () => {
    expect(placeCell(35.6586)).toBe(35.7);
    expect(placeCell(-33.94)).toBe(-33.9);
  });
});
