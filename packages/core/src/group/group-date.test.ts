import { describe, expect, test } from 'bun:test';
import type { DateResolution } from '../date/index.ts';
import { type FileGroup, groupFiles, type SourceFile } from './group.ts';
import { resolveGroupDate } from './group-date.ts';

const source = (id: string, fileName: string): SourceFile => ({
  id,
  directory: '/src',
  fileName,
});

const resolution = (
  partial: Pick<DateResolution, 'precision' | 'source'> & { hour?: number }
): DateResolution => ({
  precision: partial.precision,
  source: partial.source,
  parts:
    partial.precision === 'none' || partial.precision === 'invalid'
      ? undefined
      : {
          year: 2014,
          month: 4,
          day: 6,
          hour: partial.hour ?? 15,
          minute: 0,
          second: 0,
        },
  reason: '',
  filenamePattern: undefined,
  referenceMtime: undefined,
});

const groupOf = (...files: SourceFile[]): FileGroup => {
  const group = groupFiles(files).groups[0];
  if (!group) throw new Error('グループができなかった');
  return group;
};

describe('resolveGroupDate(date-resolution.md §8)', () => {
  test('JPEG に日付がなく、RAW の EXIF に日付があれば、RAW の日付を、JPEG にも使う', () => {
    const group = groupOf(
      source('jpg', 'IMG_0001.JPG'),
      source('raw', 'IMG_0001.CR3')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['jpg', resolution({ precision: 'none', source: 'none' })],
        ['raw', resolution({ precision: 'full', source: 'exif' })],
      ])
    );
    expect(result.resolution).toMatchObject({
      source: 'exif',
      precision: 'full',
    });
    expect(result.representative.file.id).toBe('raw');
  });

  test('取得元が確かなものを優先する(EXIF > ファイル名。精度が低くても)', () => {
    const group = groupOf(
      source('a', 'IMG_0001.JPG'),
      source('b', 'IMG_0001.CR3')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['a', resolution({ precision: 'full', source: 'filename' })],
        ['b', resolution({ precision: 'date', source: 'exif' })],
      ])
    );
    expect(result.representative.file.id).toBe('b');
  });

  test('EXIF と動画は、同じ確かさ。精度の高いほうを選ぶ', () => {
    const group = groupOf(
      source('a', 'IMG_0001.HEIC'),
      source('b', 'IMG_0001.MOV')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['a', resolution({ precision: 'date', source: 'exif' })],
        ['b', resolution({ precision: 'full', source: 'video' })],
      ])
    );
    expect(result.representative.file.id).toBe('b');
  });

  test('json は、ファイル名より優先する', () => {
    const group = groupOf(
      source('a', 'IMG_0001.JPG'),
      source('b', 'IMG_0001.CR3')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['a', resolution({ precision: 'full', source: 'filename' })],
        ['b', resolution({ precision: 'full', source: 'json' })],
      ])
    );
    expect(result.representative.file.id).toBe('b');
  });

  test('同じ品質なら、名前順で先頭のファイルを代表にする(順番に左右されない)', () => {
    const files = [
      source('1', 'IMG_0001.JPG'),
      source('2', 'IMG_0001.CR3'),
      source('3', 'IMG_0001.HEIC'),
    ];
    const same = new Map([
      ['1', resolution({ precision: 'full', source: 'exif', hour: 1 })],
      ['2', resolution({ precision: 'full', source: 'exif', hour: 2 })],
      ['3', resolution({ precision: 'full', source: 'exif', hour: 3 })],
    ]);
    const forward = resolveGroupDate(groupOf(...files), same);
    const backward = resolveGroupDate(groupOf(...[...files].reverse()), same);
    expect(forward.representative.file.fileName).toBe('IMG_0001.CR3');
    expect(backward.representative.file.fileName).toBe('IMG_0001.CR3');
  });

  test('どれも有効でなく、無効な値が 1 つでもあれば、invalid', () => {
    const group = groupOf(
      source('a', 'IMG_0001.JPG'),
      source('b', 'IMG_0001.CR3')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['a', resolution({ precision: 'none', source: 'none' })],
        ['b', resolution({ precision: 'invalid', source: 'none' })],
      ])
    );
    expect(result.resolution.precision).toBe('invalid');
  });

  test('どれも日付がなければ、none', () => {
    const group = groupOf(
      source('a', 'IMG_0001.JPG'),
      source('b', 'IMG_0001.CR3')
    );
    const result = resolveGroupDate(
      group,
      new Map([
        ['a', resolution({ precision: 'none', source: 'none' })],
        ['b', resolution({ precision: 'none', source: 'none' })],
      ])
    );
    expect(result.resolution.precision).toBe('none');
  });

  test('日付の決定の結果が足りないときは、エラー(呼び出しの誤り)', () => {
    const group = groupOf(source('a', 'IMG_0001.JPG'));
    expect(() => resolveGroupDate(group, new Map())).toThrow();
  });
});
