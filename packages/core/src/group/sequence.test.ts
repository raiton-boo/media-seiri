import { describe, expect, test } from 'bun:test';
import type { DateResolution } from '../date/index.ts';
import { groupFiles, type SourceFile } from './group.ts';
import { resolveGroupDate } from './group-date.ts';
import { choosePlacements, placeGroup, placementPath } from './sequence.ts';

const source = (id: string, fileName: string): SourceFile => ({
  id,
  directory: '/src',
  fileName,
});

const EXIF_FULL: DateResolution = {
  precision: 'full',
  source: 'exif',
  parts: { year: 2024, month: 5, day: 1, hour: 12, minute: 30, second: 45 },
  reason: '',
  filenamePattern: undefined,
  referenceMtime: undefined,
};

const planOf = (...files: SourceFile[]) => {
  const group = groupFiles(files).groups[0];
  if (!group) throw new Error('グループができなかった');
  const resolutions = new Map(
    files.map((entry) => [entry.id, EXIF_FULL] as const)
  );
  return { group, date: resolveGroupDate(group, resolutions) };
};

const names = (placements: { placement: { fileName: string } }[]): string[] =>
  placements.map((entry) => entry.placement.fileName).sort();

describe('placeGroup(仕様書 §2-3)', () => {
  test('全員が、同じフォルダと、同じ語幹を共有し、拡張子だけが違う', () => {
    const { group, date } = planOf(
      source('1', 'IMG_0001.CR3'),
      source('2', 'IMG_0001.JPG'),
      source('3', 'IMG_0001.xmp')
    );
    const placements = placeGroup(group, date);
    expect(
      new Set(placements.map((entry) => entry.placement.directory))
    ).toEqual(new Set(['2024/05']));
    expect(names(placements)).toEqual([
      '2024.05.01_12-30-45_IMG_0001.cr3',
      '2024.05.01_12-30-45_IMG_0001.jpg',
      '2024.05.01_12-30-45_IMG_0001.xmp',
    ]);
  });

  test('`-video-paired` の動画も、グループの語幹になる', () => {
    const { group, date } = planOf(
      source('1', 'IMG_1234.JPG'),
      source('2', 'IMG_1234-video-paired.mov')
    );
    expect(names(placeGroup(group, date))).toEqual([
      '2024.05.01_12-30-45_IMG_1234.jpg',
      '2024.05.01_12-30-45_IMG_1234.mov',
    ]);
  });

  test('連番は、全員に同じ番号が付く', () => {
    const { group, date } = planOf(
      source('1', 'IMG_0001.CR3'),
      source('2', 'IMG_0001.JPG')
    );
    expect(names(placeGroup(group, date, 2))).toEqual([
      '2024.05.01_12-30-45_IMG_0001_02.cr3',
      '2024.05.01_12-30-45_IMG_0001_02.jpg',
    ]);
  });
});

describe('choosePlacements(仕様書 §2-3・§2-4)', () => {
  test('衝突がなければ、連番を付けない', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const result = choosePlacements(group, date, () => false);
    expect(result.sequence).toBeUndefined();
    expect(names(result.placements)).toEqual([
      '2024.05.01_12-30-45_IMG_0001.jpg',
    ]);
  });

  test('1 つ衝突したら、_01 を付ける', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const taken = new Set(['2024/05/2024.05.01_12-30-45_IMG_0001.jpg']);
    const result = choosePlacements(group, date, (path) => taken.has(path));
    expect(result.sequence).toBe(1);
    expect(names(result.placements)).toEqual([
      '2024.05.01_12-30-45_IMG_0001_01.jpg',
    ]);
  });

  test('グループの 1 つの拡張子だけが埋まっていても、グループ全員が、次の連番に進む', () => {
    const { group, date } = planOf(
      source('1', 'IMG_0001.CR3'),
      source('2', 'IMG_0001.JPG')
    );
    // .cr3 だけが、すでにある
    const taken = new Set(['2024/05/2024.05.01_12-30-45_IMG_0001.cr3']);
    const result = choosePlacements(group, date, (path) => taken.has(path));
    expect(result.sequence).toBe(1);
    expect(names(result.placements)).toEqual([
      '2024.05.01_12-30-45_IMG_0001_01.cr3',
      '2024.05.01_12-30-45_IMG_0001_01.jpg',
    ]);
  });

  test('_01 も埋まっていれば、_02 に進む', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const taken = new Set([
      '2024/05/2024.05.01_12-30-45_IMG_0001.jpg',
      '2024/05/2024.05.01_12-30-45_IMG_0001_01.jpg',
    ]);
    expect(
      choosePlacements(group, date, (path) => taken.has(path)).sequence
    ).toBe(2);
  });

  test('グループの中で、同じ名前になるメンバーがいるときは、エラー(連番では解決できない)', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const duplicated = {
      ...group,
      members: [...group.members, ...group.members],
    };
    expect(() => choosePlacements(duplicated, date, () => false)).toThrow(
      '同じ名前になるメンバー'
    );
  });

  test('予約済みの名前(今回の実行で取った名前)も、衝突として扱える', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const reserved = new Set<string>();
    const first = choosePlacements(group, date, (path) => reserved.has(path));
    for (const entry of first.placements)
      reserved.add(placementPath(entry.placement));
    const second = choosePlacements(group, date, (path) => reserved.has(path));
    expect(first.sequence).toBeUndefined();
    expect(second.sequence).toBe(1);
  });

  test('100 以上も、桁を増やして続く', () => {
    const { group, date } = planOf(source('1', 'IMG_0001.JPG'));
    const taken = (path: string): boolean => {
      const match = path.match(/_(\d+)\.jpg$/);
      return !match || Number(match[1]) < 100;
    };
    const result = choosePlacements(group, date, taken);
    expect(result.sequence).toBe(100);
    expect(names(result.placements)).toEqual([
      '2024.05.01_12-30-45_IMG_0001_100.jpg',
    ]);
  });
});
