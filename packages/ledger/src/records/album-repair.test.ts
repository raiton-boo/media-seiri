import { describe, expect, test } from 'bun:test';
import { resolveDate } from '@file-seiri/core';
import {
  countAlbumEvents,
  getAlbumEvent,
  listAlbumEvents,
  replaceAlbumEvents,
} from './album-events.ts';
import { insertFileGroup } from './file-groups.ts';
import {
  openDb,
  seedContent,
  seedRun,
  seedSourceFile,
  T0,
  T1,
} from './fixtures.ts';
import {
  getLibraryFile,
  insertLibraryFile,
  listLibraryFilesByAlbumEvent,
} from './library-files.ts';
import { upsertMediaMetadata } from './media-metadata.ts';
import {
  listRepairAttempts,
  listRepairAttemptsByRun,
  recordRepairAttempt,
} from './repair-attempts.ts';

const OPTIONS = {
  now: new Date('2026-10-18T00:00:00Z'),
  timeZone: 'Asia/Tokyo',
};

/** 撮影日時つきの、ライブラリのファイルを作る */
const seedPhoto = (
  db: ReturnType<typeof openDb>,
  runId: number,
  name: string,
  parts: { year: number; month: number; day: number; hour: number }
): number => {
  const contentId = seedContent(db);
  upsertMediaMetadata(db, {
    contentId,
    date: resolveDate(
      {
        fileName: name,
        exif: {
          dateTimeOriginal: {
            kind: 'value',
            parts: { ...parts, minute: 0, second: 0 },
          },
        },
      },
      OPTIONS
    ),
  });
  return insertLibraryFile(db, {
    contentId,
    groupId: insertFileGroup(db, { stem: name, bucket: 'full' }),
    runId,
    relPath: `2024/03/${name}`,
    bucket: 'full',
    createdAt: T0,
  });
};

const setup = () => {
  const db = openDb();
  const seed = seedRun(db);
  const a = seedPhoto(db, seed.runId, 'a.jpg', {
    year: 2024,
    month: 3,
    day: 5,
    hour: 12,
  });
  const b = seedPhoto(db, seed.runId, 'b.jpg', {
    year: 2024,
    month: 3,
    day: 5,
    hour: 9,
  });
  const c = seedPhoto(db, seed.runId, 'c.jpg', {
    year: 2024,
    month: 3,
    day: 9,
    hour: 10,
  });
  const d = seedPhoto(db, seed.runId, 'd.jpg', {
    year: 2024,
    month: 3,
    day: 20,
    hour: 10,
  });
  return { db, seed, a, b, c, d };
};

describe('album_events', () => {
  test('保存すると、件数・代表・所属が入り、読める', () => {
    const { db, a, b, c } = setup();
    const [first, second] = replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05T09:00:00',
          endAt: '2024-03-05T12:00:00',
          rule: '4h',
          centroidLat: 35.6,
          centroidLon: 139.7,
          coverLibraryFileId: a,
          libraryFileIds: [a, b],
        },
        {
          startAt: '2024-03-09',
          endAt: '2024-03-09',
          rule: '1d',
          libraryFileIds: [c],
        },
      ],
      7
    ) as [number, number];

    expect(getAlbumEvent(db, first)).toEqual({
      albumEventId: first,
      startAt: '2024-03-05T09:00:00',
      endAt: '2024-03-05T12:00:00',
      fileCount: 2,
      centroidLat: 35.6,
      centroidLon: 139.7,
      coverLibraryFileId: a,
      rule: '4h',
      computedRevision: 7,
    });
    expect(getAlbumEvent(db, second)).toMatchObject({
      fileCount: 1,
      coverLibraryFileId: null,
      centroidLat: null,
    });
    expect(getLibraryFile(db, a)?.albumEventId).toBe(first);
    expect(getLibraryFile(db, c)?.albumEventId).toBe(second);
    expect(getAlbumEvent(db, 999)).toBeUndefined();
  });

  test('できごとの写真は、撮影日時の順に読める', () => {
    const { db, a, b } = setup();
    const [id] = replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05T09:00:00',
          endAt: '2024-03-05T12:00:00',
          rule: '4h',
          libraryFileIds: [a, b],
        },
      ],
      1
    ) as [number];
    expect(
      listLibraryFilesByAlbumEvent(db, id).map((file) => file.libraryFileId)
    ).toEqual([b, a]);
  });

  test('一覧は、新しい順。件数と位置で絞れる', () => {
    const { db, a, b, c, d } = setup();
    replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05T09:00:00',
          endAt: '2024-03-05T12:00:00',
          rule: '4h',
          libraryFileIds: [a, b],
        },
        {
          startAt: '2024-03-20',
          endAt: '2024-03-20',
          rule: '1d',
          libraryFileIds: [d],
        },
        {
          startAt: '2024-03-09',
          endAt: '2024-03-09',
          rule: '1d',
          libraryFileIds: [c],
        },
      ],
      1
    );
    expect(listAlbumEvents(db).map((event) => event.startAt)).toEqual([
      '2024-03-20',
      '2024-03-09',
      '2024-03-05T09:00:00',
    ]);
    expect(
      listAlbumEvents(db, { limit: 1, offset: 1 }).map((event) => event.startAt)
    ).toEqual(['2024-03-09']);
    expect(countAlbumEvents(db)).toBe(3);
  });

  test('保存し直すと、前のできごとと所属は、すべて入れ替わる', () => {
    const { db, a, b, c } = setup();
    replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05',
          endAt: '2024-03-05',
          rule: '1d',
          libraryFileIds: [a, b],
        },
      ],
      1
    );
    const [id] = replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-09',
          endAt: '2024-03-09',
          rule: '1d',
          libraryFileIds: [c],
        },
      ],
      2
    ) as [number];
    expect(countAlbumEvents(db)).toBe(1);
    expect(getLibraryFile(db, a)?.albumEventId).toBeNull();
    expect(getLibraryFile(db, b)?.albumEventId).toBeNull();
    expect(getLibraryFile(db, c)?.albumEventId).toBe(id);
    expect(getAlbumEvent(db, id)?.computedRevision).toBe(2);
  });

  test('空のリストで、すべてのできごとを消せる(写真は残る)', () => {
    const { db, a } = setup();
    replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05',
          endAt: '2024-03-05',
          rule: '1d',
          libraryFileIds: [a],
        },
      ],
      1
    );
    expect(replaceAlbumEvents(db, [], 2)).toEqual([]);
    expect(countAlbumEvents(db)).toBe(0);
    expect(getLibraryFile(db, a)).toBeDefined();
  });

  test('不正な入力は、エラー(写真が 0 枚・代表が外・重なり・ない写真)', () => {
    const { db, a, b } = setup();
    const base = { startAt: '2024-03-05', endAt: '2024-03-05', rule: '1d' };
    expect(() =>
      replaceAlbumEvents(db, [{ ...base, libraryFileIds: [] }], 1)
    ).toThrow(RangeError);
    expect(() =>
      replaceAlbumEvents(
        db,
        [{ ...base, coverLibraryFileId: b, libraryFileIds: [a] }],
        1
      )
    ).toThrow(RangeError);
    expect(() =>
      replaceAlbumEvents(
        db,
        [
          { ...base, libraryFileIds: [a] },
          { ...base, libraryFileIds: [a, b] },
        ],
        1
      )
    ).toThrow(RangeError);
    expect(() =>
      replaceAlbumEvents(db, [{ ...base, libraryFileIds: [a, 999] }], 1)
    ).toThrow('999');
  });

  test('失敗したら、前のできごとが、そのまま残る', () => {
    const { db, a, b } = setup();
    const [id] = replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05',
          endAt: '2024-03-05',
          rule: '1d',
          libraryFileIds: [a],
        },
      ],
      1
    ) as [number];
    expect(() =>
      replaceAlbumEvents(
        db,
        [
          {
            startAt: '2024-03-06',
            endAt: '2024-03-06',
            rule: '1d',
            libraryFileIds: [b, 999],
          },
        ],
        2
      )
    ).toThrow();
    expect(countAlbumEvents(db)).toBe(1);
    expect(getAlbumEvent(db, id)?.computedRevision).toBe(1);
    expect(getLibraryFile(db, a)?.albumEventId).toBe(id);
    expect(getLibraryFile(db, b)?.albumEventId).toBeNull();
  });

  test('代表の写真を、あとで消しても、できごとは残る', () => {
    const { db, a, b } = setup();
    const [id] = replaceAlbumEvents(
      db,
      [
        {
          startAt: '2024-03-05',
          endAt: '2024-03-05',
          rule: '1d',
          coverLibraryFileId: a,
          libraryFileIds: [a, b],
        },
      ],
      1
    ) as [number];
    db.query('DELETE FROM library_files WHERE library_file_id = ?').run(a);
    expect(getAlbumEvent(db, id)?.coverLibraryFileId).toBeNull();
  });
});

describe('repair_attempts', () => {
  test('試した手順を記録して、ファイルごと・実行ごとに読める', () => {
    const db = openDb();
    const seed = seedRun(db);
    const file = seedSourceFile(db, seed, {
      relPath: 'a.mp4',
      kind: 'video',
      ext: 'mp4',
    });
    const other = seedSourceFile(db, seed, { relPath: 'b.jpg' });
    const first = recordRepairAttempt(db, {
      sourceFileId: file,
      method: 'video_remux',
      isSuccess: false,
      detail: 'moov がない',
      attemptedAt: T0,
    });
    recordRepairAttempt(db, {
      sourceFileId: file,
      method: 'metadata_rewrite',
      isSuccess: true,
      outputPath: 'repaired/a.mp4',
      attemptedAt: T1,
    });
    recordRepairAttempt(db, {
      sourceFileId: other,
      method: 'image_salvage',
      isSuccess: false,
      attemptedAt: T1,
    });
    const another = seedRun(db, { uuid: 'vol-2' });
    recordRepairAttempt(db, {
      sourceFileId: seedSourceFile(db, another),
      method: 'image_salvage',
      isSuccess: true,
      attemptedAt: T1,
    });

    expect(listRepairAttempts(db, file)).toEqual([
      {
        attemptId: first,
        sourceFileId: file,
        method: 'video_remux',
        isSuccess: false,
        outputPath: null,
        detail: 'moov がない',
        attemptedAt: '2026-10-18T00:00:00.000Z',
      },
      expect.objectContaining({
        method: 'metadata_rewrite',
        isSuccess: true,
        outputPath: 'repaired/a.mp4',
        detail: '',
      }),
    ]);
    expect(listRepairAttemptsByRun(db, seed.runId)).toHaveLength(3);
    expect(listRepairAttempts(db, 999)).toEqual([]);
  });

  test('ない手順・ないファイルは、記録できない', () => {
    const db = openDb();
    const file = seedSourceFile(db, seedRun(db));
    const base = { isSuccess: true, attemptedAt: T0 };
    expect(() =>
      recordRepairAttempt(db, {
        ...base,
        sourceFileId: file,
        method: 'magic' as never,
      })
    ).toThrow();
    expect(() =>
      recordRepairAttempt(db, {
        ...base,
        sourceFileId: 999,
        method: 'video_remux',
      })
    ).toThrow();
  });
});
