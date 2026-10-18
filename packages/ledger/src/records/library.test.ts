import { describe, expect, test } from 'bun:test';
import {
  choosePlacements,
  groupFiles,
  placementPath,
  resolveDate,
  resolveGroupDate,
} from '@file-seiri/core';
import {
  findDuplicateLinkBySource,
  insertDuplicateLink,
  listDuplicateLinksByAdopted,
} from './duplicate-links.ts';
import { getFileGroup, insertFileGroup } from './file-groups.ts';
import {
  openDb,
  seedContent,
  seedRun,
  seedSourceFile,
  T0,
} from './fixtures.ts';
import {
  getLibraryFile,
  insertLibraryFile,
  libraryPathExists,
  listLibraryFilesByContent,
  listLibraryFilesByGroup,
  listThumbnailCandidates,
  setThumbRelPath,
} from './library-files.ts';

const seedLibraryFile = (
  db: ReturnType<typeof openDb>,
  seed: { runId: number },
  extra: Partial<Parameters<typeof insertLibraryFile>[1]> = {}
): number =>
  insertLibraryFile(db, {
    contentId: seedContent(db),
    groupId: insertFileGroup(db, { stem: 'IMG_0001', bucket: 'full' }),
    runId: seed.runId,
    relPath: '2024/03/20240305_IMG_0001.jpg',
    bucket: 'full',
    createdAt: T0,
    ...extra,
  });

describe('file_groups・library_files', () => {
  test('グループを追加して、読める', () => {
    const db = openDb();
    const id = insertFileGroup(db, {
      stem: 'IMG_0001',
      bucket: 'time_unknown',
    });
    expect(getFileGroup(db, id)).toEqual({
      groupId: id,
      stem: 'IMG_0001',
      bucket: 'time_unknown',
    });
    expect(getFileGroup(db, 999)).toBeUndefined();
  });

  test('ライブラリのファイルを記録して、読める', () => {
    const db = openDb();
    const seed = seedRun(db);
    const id = seedLibraryFile(db, seed, {
      thumbRelPath: 'ab/cd.webp',
      isRepaired: true,
    });
    expect(getLibraryFile(db, id)).toMatchObject({
      libraryFileId: id,
      relPath: '2024/03/20240305_IMG_0001.jpg',
      bucket: 'full',
      isRepaired: true,
      thumbRelPath: 'ab/cd.webp',
      createdAt: '2026-10-18T00:00:00.000Z',
      albumEventId: null,
    });
    expect(getLibraryFile(db, 999)).toBeUndefined();
  });

  test('同じパスは、記録できない。大文字小文字だけが違っても、できない', () => {
    const db = openDb();
    const seed = seedRun(db);
    seedLibraryFile(db, seed);
    expect(() => seedLibraryFile(db, seed)).toThrow();
    expect(() =>
      seedLibraryFile(db, seed, { relPath: '2024/03/20240305_img_0001.JPG' })
    ).toThrow();
  });

  test('libraryPathExists は、大文字小文字を区別しない', () => {
    const db = openDb();
    seedLibraryFile(db, seedRun(db));
    expect(libraryPathExists(db, '2024/03/20240305_IMG_0001.jpg')).toBe(true);
    expect(libraryPathExists(db, '2024/03/20240305_img_0001.JPG')).toBe(true);
    expect(libraryPathExists(db, '2024/03/20240305_IMG_0002.jpg')).toBe(false);
  });

  test('サムネイルの候補は、ハッシュつきで返り、場所を記録すると、反映される', () => {
    const db = openDb();
    const seed = seedRun(db);
    const id = seedLibraryFile(db, seed);
    const [candidate] = listThumbnailCandidates(db);
    expect(candidate).toEqual({
      libraryFileId: id,
      relPath: '2024/03/20240305_IMG_0001.jpg',
      thumbRelPath: null,
      contentHash: expect.stringMatching(/^[0-9]{64}$/),
    });
    setThumbRelPath(db, id, '00/abc.jpg');
    expect(getLibraryFile(db, id)?.thumbRelPath).toBe('00/abc.jpg');
    expect(listThumbnailCandidates(db)[0]?.thumbRelPath).toBe('00/abc.jpg');
    expect(() => setThumbRelPath(db, 999, 'x.jpg')).toThrow();
  });

  test('core の choosePlacements と組み合わせると、衝突のとき、連番を選ぶ', () => {
    const db = openDb();
    const seed = seedRun(db);
    const [group] = groupFiles([
      { id: '1', directory: 'DCIM', fileName: 'IMG_0001.JPG' },
    ]).groups;
    if (!group) throw new Error('グループができなかった');
    const date = resolveGroupDate(
      group,
      new Map([
        [
          '1',
          resolveDate(
            {
              fileName: 'IMG_0001.JPG',
              exif: {
                dateTimeOriginal: {
                  kind: 'value',
                  parts: {
                    year: 2024,
                    month: 3,
                    day: 5,
                    hour: 10,
                    minute: 20,
                    second: 30,
                  },
                },
              },
            },
            { now: new Date('2026-10-18T00:00:00Z'), timeZone: 'Asia/Tokyo' }
          ),
        ],
      ])
    );
    const isTaken = (path: string): boolean => libraryPathExists(db, path);

    const first = choosePlacements(group, date, isTaken);
    expect(first.sequence).toBeUndefined();
    const firstPath = placementPath(
      first.placements[0]?.placement ?? (undefined as never)
    );
    seedLibraryFile(db, seed, { relPath: firstPath });

    const second = choosePlacements(group, date, isTaken);
    expect(second.sequence).toBe(1);
  });

  test('同じ内容・同じグループのファイルを、すべて探せる(原本の探索)', () => {
    const db = openDb();
    const seed = seedRun(db);
    const contentId = seedContent(db);
    const groupId = insertFileGroup(db, { stem: 'IMG_0001', bucket: 'full' });
    const a = seedLibraryFile(db, seed, {
      contentId,
      groupId,
      relPath: 'a.jpg',
    });
    const b = seedLibraryFile(db, seed, {
      contentId,
      groupId,
      relPath: 'b.cr3',
    });
    seedLibraryFile(db, seed, { relPath: 'c.jpg' });
    expect(
      listLibraryFilesByContent(db, contentId).map((f) => f.libraryFileId)
    ).toEqual([a, b]);
    expect(
      listLibraryFilesByGroup(db, groupId).map((f) => f.libraryFileId)
    ).toEqual([a, b]);
  });
});

describe('duplicate_links', () => {
  test('スキップ側と採用側の対応を記録して、両方向に探せる', () => {
    const db = openDb();
    const seed = seedRun(db);
    const adopted = seedLibraryFile(db, seed);
    const skippedA = seedSourceFile(db, seed, { relPath: 'a.jpg' });
    const skippedB = seedSourceFile(db, seed, { relPath: 'b.jpg' });
    insertDuplicateLink(db, {
      skippedSourceFileId: skippedA,
      adoptedLibraryFileId: adopted,
      createdAt: T0,
    });
    insertDuplicateLink(db, {
      skippedSourceFileId: skippedB,
      adoptedLibraryFileId: adopted,
      createdAt: T0,
    });

    expect(findDuplicateLinkBySource(db, skippedA)).toMatchObject({
      skippedSourceFileId: skippedA,
      adoptedLibraryFileId: adopted,
      createdAt: '2026-10-18T00:00:00.000Z',
    });
    expect(findDuplicateLinkBySource(db, 999)).toBeUndefined();
    expect(
      listDuplicateLinksByAdopted(db, adopted).map((l) => l.skippedSourceFileId)
    ).toEqual([skippedA, skippedB]);
  });

  test('スキップ側は、2 度記録できない', () => {
    const db = openDb();
    const seed = seedRun(db);
    const adopted = seedLibraryFile(db, seed);
    const skipped = seedSourceFile(db, seed);
    const link = {
      skippedSourceFileId: skipped,
      adoptedLibraryFileId: adopted,
      createdAt: T0,
    };
    insertDuplicateLink(db, link);
    expect(() => insertDuplicateLink(db, link)).toThrow();
  });
});
