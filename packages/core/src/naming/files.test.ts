import { describe, expect, test } from 'bun:test';
import { classifyFile, extensionOf, type FileKind, stemOf } from './files.ts';

describe('classifyFile(仕様書 §1-1)', () => {
  test('写真・RAW・動画・サイドカー', () => {
    expect(classifyFile('IMG_0001.jpg')).toBe('photo');
    expect(classifyFile('a.HEIC')).toBe('photo');
    expect(classifyFile('IMG_0001.CR3')).toBe('raw');
    expect(classifyFile('DSC_0001.NEF')).toBe('raw');
    expect(classifyFile('MOV_0001.mp4')).toBe('video');
    expect(classifyFile('clip.M2T')).toBe('video');
    expect(classifyFile('IMG_0001.xmp')).toBe('xmp');
    expect(classifyFile('IMG_0001.jpg.json')).toBe('json');
  });

  test('拡張子の大文字小文字は、区別しない', () => {
    expect(classifyFile('A.JpG')).toBe('photo');
    expect(classifyFile('A.jPeG')).toBe('photo');
  });

  test('対象外(.aae・.thm・.lrv など、拡張子がないもの)', () => {
    for (const name of ['IMG_0001.aae', 'a.thm', 'a.lrv', 'README', 'a.html']) {
      expect(classifyFile(name)).toBe('unsupported');
    }
  });

  test('設定で、拡張子を足せる', () => {
    const extra = new Map<string, FileKind>([['jxl', 'photo']]);
    expect(classifyFile('a.jxl')).toBe('unsupported');
    expect(classifyFile('a.jxl', extra)).toBe('photo');
  });
});

describe('extensionOf・stemOf', () => {
  test('拡張子と語幹', () => {
    expect(extensionOf('IMG_0001.JPG')).toBe('jpg');
    expect(stemOf('IMG_0001.JPG')).toBe('IMG_0001');
    expect(extensionOf('a.b.c.mov')).toBe('mov');
    expect(stemOf('a.b.c.mov')).toBe('a.b.c');
  });

  test('拡張子がない・ドットだけの名前', () => {
    expect(extensionOf('README')).toBe('');
    expect(stemOf('README')).toBe('README');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});
