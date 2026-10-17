import { describe, expect, test } from 'bun:test';
import { isExcludedName } from './exclusion.ts';

describe('isExcludedName(仕様書 §1-2)', () => {
  test('ドライブの管理用ファイル・フォルダは、除外する', () => {
    for (const name of [
      '.DS_Store',
      'Thumbs.db',
      '.Trashes',
      '.Spotlight-V100',
      '.fseventsd',
      '$RECYCLE.BIN',
      'System Volume Information',
    ]) {
      expect(isExcludedName(name)).toBe(true);
    }
  });

  test('大文字小文字は、区別しない', () => {
    expect(isExcludedName('thumbs.DB')).toBe(true);
    expect(isExcludedName('$recycle.bin')).toBe(true);
  });

  test('`._` で始まる付属ファイル(AppleDouble)は、写真と同じ拡張子でも、除外する', () => {
    expect(isExcludedName('._DSC_0001.jpg')).toBe(true);
    expect(isExcludedName('._IMG_0001.JPG')).toBe(true);
  });

  test('写真アプリのライブラリは、除外する', () => {
    expect(isExcludedName('Photos Library.photoslibrary')).toBe(true);
  });

  test('ふつうのファイルは、除外しない(先頭が `_` だけのものも)', () => {
    for (const name of [
      'IMG_0001.jpg',
      '_IMG_0001.jpg',
      'DSC_0001.JPG',
      '写真',
    ]) {
      expect(isExcludedName(name)).toBe(false);
    }
  });
});
