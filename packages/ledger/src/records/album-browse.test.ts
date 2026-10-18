import { describe, expect, test } from 'bun:test';
import {
  getEventDetail,
  listEventStacks,
  listMonthSummaries,
  listOnThisDay,
  listYearCounts,
  pickPhotoOfDay,
} from './album-browse.ts';
import { replaceAlbumEvents } from './album-events.ts';
import { getOrCreateContent } from './contents.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, T0 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';

type Spec = {
  rel: string;
  takenAt: string | null;
  precision?: string;
  gps?: boolean;
  thumb?: boolean;
  camera?: string;
};

/** 写真を作る(メタデータ・サムネイル・GPS・カメラ) */
const build = (specs: Spec[]) => {
  const db = openDb();
  const seed = seedRun(db);
  let n = 0;
  const ids = new Map<string, number>();
  for (const spec of specs) {
    n += 1;
    const { content } = getOrCreateContent(db, {
      hash: String(n).padStart(64, 'f'),
      sizeBytes: 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, gps_lat, gps_lon, camera_model, width, height)
       VALUES (?, ?, ?, 'exif', ?, ?, ?, 1200, 800)`
    ).run(
      content.contentId,
      spec.takenAt,
      spec.precision ?? (spec.takenAt === null ? 'none' : 'full'),
      spec.gps ? 35 : null,
      spec.gps ? 139 : null,
      spec.camera ?? null
    );
    ids.set(
      spec.rel,
      insertLibraryFile(db, {
        contentId: content.contentId,
        groupId: insertFileGroup(db, { stem: spec.rel, bucket: 'full' }),
        runId: seed.runId,
        relPath: spec.rel,
        bucket: 'full',
        ...(spec.thumb === false
          ? {}
          : { thumbRelPath: `${String(n).padStart(2, '0')}/t${n}.jpg` }),
        createdAt: T0,
      })
    );
  }
  const id = (rel: string): number => ids.get(rel) as number;
  const event = (
    rels: string[],
    startAt: string,
    endAt: string,
    cover?: string
  ) => ({
    startAt,
    endAt,
    rule: '4h/5km',
    libraryFileIds: rels.map(id),
    ...(cover ? { coverLibraryFileId: id(cover) } : {}),
  });
  return { db, id, event };
};

describe('listYearCounts', () => {
  const { db } = build([
    { rel: 'a.jpg', takenAt: '2016-01-02T10:00:00' },
    { rel: 'b.jpg', takenAt: '2014-04-05T10:00:00' },
    { rel: 'c.jpg', takenAt: '2014-04-06', precision: 'date' },
    { rel: 'd.jpg', takenAt: '2014', precision: 'year' },
    { rel: 'e.jpg', takenAt: null },
  ]);
  test('年ごとの枚数(精度の低いものも、その年に入る)と、日付のない枚数。新しい順・古い順', () => {
    expect(listYearCounts(db, 'new')).toEqual({
      years: [
        { year: 2016, count: 1 },
        { year: 2014, count: 3 },
      ],
      undated: 1,
      total: 5,
    });
    expect(listYearCounts(db, 'old').years.map((y) => y.year)).toEqual([
      2014, 2016,
    ]);
  });
});

describe('listMonthSummaries', () => {
  const { db, id } = build([
    { rel: 'jan1.jpg', takenAt: '2014-01-05T10:00:00' },
    { rel: 'jan2.jpg', takenAt: '2014-01-09T10:00:00', gps: true },
    { rel: 'jan3.jpg', takenAt: '2014-01-02T10:00:00', thumb: false },
    { rel: 'apr.jpg', takenAt: '2014-04-06', precision: 'date' },
    { rel: 'yearonly.jpg', takenAt: '2014', precision: 'year' },
    { rel: 'other.jpg', takenAt: '2015-04-01T00:00:00' },
  ]);
  test('12 か月ぶん。枚数 0 の月も含む。月が分からない(精度 year)ものは、月に入らない', () => {
    const months = listMonthSummaries(db, 2014, 'old');
    expect(months.map((m) => m.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(months.map((m) => m.count)).toEqual([
      3, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(listMonthSummaries(db, 2014, 'new')[0]?.month).toBe(12);
  });
  test('代表は、サムネイルがあるもののうち、GPS つきを優先し、なければ、いちばん早いもの', () => {
    const months = listMonthSummaries(db, 2014, 'old');
    expect(months[0]?.cover?.libraryFileId).toBe(id('jan2.jpg'));
    expect(months[3]?.cover?.libraryFileId).toBe(id('apr.jpg'));
    expect(months[1]?.cover).toBeNull();
  });
});

describe('listEventStacks・getEventDetail', () => {
  const setup = () => {
    const ctx = build([
      { rel: 'a1.jpg', takenAt: '2014-04-05T10:00:00', camera: 'Canon' },
      { rel: 'a2.jpg', takenAt: '2014-04-05T10:10:00', camera: 'Canon' },
      { rel: 'a3.jpg', takenAt: '2014-04-05T10:20:00', camera: 'Sony' },
      { rel: 'a4.jpg', takenAt: '2014-04-05T10:30:00', thumb: false },
      { rel: 'b1.jpg', takenAt: '2014-04-13T09:00:00' },
      { rel: 'c1.jpg', takenAt: '2014-05-01T09:00:00' },
    ]);
    replaceAlbumEvents(
      ctx.db,
      [
        ctx.event(
          ['a1.jpg', 'a2.jpg', 'a3.jpg', 'a4.jpg'],
          '2014-04-05T10:00:00',
          '2014-04-05T10:30:00',
          'a3.jpg'
        ),
        ctx.event(['b1.jpg'], '2014-04-13T09:00:00', '2014-04-13T09:00:00'),
        ctx.event(['c1.jpg'], '2014-05-01T09:00:00', '2014-05-01T09:00:00'),
      ],
      3
    );
    return ctx;
  };

  test('月のできごとを、新しい順・古い順で返す。束は、代表が先頭で、サムネイルのある最大 3 枚', () => {
    const { db, id } = setup();
    const stacks = listEventStacks(db, 2014, 4, 'new');
    expect(stacks.map((s) => s.startAt)).toEqual([
      '2014-04-13T09:00:00',
      '2014-04-05T10:00:00',
    ]);
    expect(listEventStacks(db, 2014, 4, 'old').map((s) => s.fileCount)).toEqual(
      [4, 1]
    );
    const big = stacks[1];
    expect(big?.photos.map((p) => p.libraryFileId)).toEqual([
      id('a3.jpg'),
      id('a1.jpg'),
      id('a2.jpg'),
    ]);
    expect(listEventStacks(db, 2014, 6, 'new')).toEqual([]);
  });

  test('できごとの詳細: 写真(撮影の順)・ページ送り・いちばん多いカメラ・前後のできごと', () => {
    const { db } = setup();
    const events = listEventStacks(db, 2014, 4, 'old');
    const first = events[0]?.albumEventId as number;
    const second = events[1]?.albumEventId as number;
    const detail = getEventDetail(db, first, 'old', { limit: 2, offset: 0 });
    expect(detail?.fileCount).toBe(4);
    expect(detail?.photos.map((p) => p.relPath)).toEqual(['a1.jpg', 'a2.jpg']);
    expect(detail?.camera).toBe('Canon');
    expect(detail?.previous).toBeNull();
    expect(detail?.next?.albumEventId).toBe(second);
    const paged = getEventDetail(db, first, 'old', { limit: 5, offset: 2 });
    expect(paged?.photos.map((p) => p.relPath)).toEqual(['a3.jpg', 'a4.jpg']);
    // 新しい順では、前 = より新しい(別の月でも、前後に数える)、次 = より古い
    const asNew = getEventDetail(db, second, 'new', { limit: 5, offset: 0 });
    expect(asNew?.previous?.startAt).toBe('2014-05-01T09:00:00');
    expect(asNew?.next?.albumEventId).toBe(first);
    expect(
      getEventDetail(db, 999, 'new', { limit: 5, offset: 0 })
    ).toBeUndefined();
  });
});

describe('listOnThisDay・pickPhotoOfDay', () => {
  const ctx = build([
    { rel: 'y15.jpg', takenAt: '2015-10-17T10:00:00', gps: true },
    { rel: 'y14.jpg', takenAt: '2014-10-17T10:00:00' },
    { rel: 'y13.jpg', takenAt: '2013-10-17T10:00:00' },
    { rel: 'y12.jpg', takenAt: '2012-10-17T10:00:00' },
    { rel: 'now.jpg', takenAt: '2016-10-17T10:00:00' },
    { rel: 'other.jpg', takenAt: '2015-10-18T10:00:00' },
  ]);
  replaceAlbumEvents(
    ctx.db,
    ['y15', 'y14', 'y13', 'y12', 'now', 'other'].map((name) => {
      const rel = `${name}.jpg`;
      return ctx.event([rel], '2000-01-01T00:00:00', '2000-01-01T00:00:00');
    }),
    1
  );
  // 開始日時を、実際の日時にそろえる
  for (const [rel, at] of [
    ['y15', '2015-10-17T10:00:00'],
    ['y14', '2014-10-17T10:00:00'],
    ['y13', '2013-10-17T10:00:00'],
    ['y12', '2012-10-17T10:00:00'],
    ['now', '2016-10-17T10:00:00'],
    ['other', '2015-10-18T10:00:00'],
  ] as const) {
    ctx.db
      .query(
        'UPDATE album_events SET start_at = ?, end_at = ? WHERE album_event_id = (SELECT album_event_id FROM library_files WHERE rel_path = ?)'
      )
      .run(at, at, `${rel}.jpg`);
  }

  test('去年の今日: 同じ月日の、過去の年だけ。新しい年から、最大 limit 件。代表の写真つき', () => {
    const result = listOnThisDay(ctx.db, 10, 17, 2016, 3);
    expect(result.map((r) => r.startAt.slice(0, 4))).toEqual([
      '2015',
      '2014',
      '2013',
    ]);
    expect(result[0]?.cover?.relPath).toBe('y15.jpg');
    expect(listOnThisDay(ctx.db, 1, 1, 2016, 3)).toEqual([]);
  });

  test('今日の一枚: seed が同じなら、同じ 1 枚。seed が違えば、別の 1 枚。負の seed でも選べる', () => {
    const a = pickPhotoOfDay(ctx.db, 7);
    expect(pickPhotoOfDay(ctx.db, 7)?.libraryFileId).toBe(a?.libraryFileId);
    expect(pickPhotoOfDay(ctx.db, 8)?.libraryFileId).not.toBe(a?.libraryFileId);
    expect(pickPhotoOfDay(ctx.db, -1)).not.toBeNull();
    expect(pickPhotoOfDay(openDb(), 3)).toBeNull();
  });
});
