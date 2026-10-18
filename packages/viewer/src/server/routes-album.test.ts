import { describe, expect, test } from 'bun:test';
import {
  getOrCreateContent,
  insertFileGroup,
  insertLibraryFile,
  replaceAlbumEvents,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import type {
  AlbumEventResponse,
  AlbumMemoriesResponse,
  AlbumMonthResponse,
  AlbumOverviewResponse,
  AlbumYearResponse,
} from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { get, makeSource, NOW } from './test-support.ts';

const seed = () => {
  const source = makeSource();
  const { db } = source.ledger;
  const volume = upsertVolume(db, { volumeUuid: 'v', seenAt: NOW });
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  let n = 0;
  const add = (takenAt: string): number => {
    n += 1;
    const { content } = getOrCreateContent(db, {
      hash: String(n).padStart(64, 'd'),
      sizeBytes: 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, width, height)
       VALUES (?, ?, 'full', 'exif', 1200, 800)`
    ).run(content.contentId, takenAt);
    return insertLibraryFile(db, {
      contentId: content.contentId,
      groupId: insertFileGroup(db, { stem: `p${n}`, bucket: 'full' }),
      runId,
      relPath: `p${n}.jpg`,
      bucket: 'full',
      thumbRelPath: `${String(n).padStart(2, '0')}/t${n}.jpg`,
      createdAt: NOW,
    });
  };
  // 2014 年 4 月: 3 枚のできごと(束)と、1 枚の小さなできごと。2015 年 4 月 6 日にも 1 つ
  const big = [
    add('2014-04-05T10:00:00'),
    add('2014-04-05T10:10:00'),
    add('2014-04-05T10:20:00'),
  ];
  const small = add('2014-04-20T09:00:00');
  const old = add('2013-04-06T09:00:00');
  replaceAlbumEvents(
    db,
    [
      {
        startAt: '2013-04-06T09:00:00',
        endAt: '2013-04-06T09:00:00',
        rule: 'r',
        libraryFileIds: [old],
      },
      {
        startAt: '2014-04-05T10:00:00',
        endAt: '2014-04-05T10:20:00',
        rule: 'r',
        libraryFileIds: big,
        coverLibraryFileId: big[1] as number,
      },
      {
        startAt: '2014-04-20T09:00:00',
        endAt: '2014-04-20T09:00:00',
        rule: 'r',
        libraryFileIds: [small],
      },
    ],
    1
  );
  return { source, big };
};

describe('/api/album', () => {
  test('overview: 年ごとの枚数と、最新の年。order=old で、古い年から', async () => {
    const app = createViewerApp(seed().source);
    const body = (await (
      await get(app, '/api/album/overview')
    ).json()) as AlbumOverviewResponse;
    expect(body).toMatchObject({
      latestYear: 2014,
      total: 5,
      undated: 0,
      order: 'new',
    });
    expect(body.years).toEqual([
      { year: 2014, count: 4 },
      { year: 2013, count: 1 },
    ]);
    const old = (await (
      await get(app, '/api/album/overview?order=old')
    ).json()) as AlbumOverviewResponse;
    expect(old.years.map((y) => y.year)).toEqual([2013, 2014]);
  });

  test('year: 12 か月ぶん。y が不正なら 400', async () => {
    const app = createViewerApp(seed().source);
    const body = (await (
      await get(app, '/api/album/year?y=2014&order=old')
    ).json()) as AlbumYearResponse;
    expect(body.total).toBe(4);
    expect(body.months).toHaveLength(12);
    expect(body.months[3]).toMatchObject({ month: 4, count: 4 });
    expect(body.months[3]?.cover?.thumbRelPath).toContain('/t');
    expect((await get(app, '/api/album/year?y=abc')).status).toBe(400);
    expect((await get(app, '/api/album/year')).status).toBe(400);
  });

  test('month: できごと(3 枚以上)と、小さなできごと(3 枚未満)に分ける。m が不正なら 400', async () => {
    const app = createViewerApp(seed().source);
    const body = (await (
      await get(app, '/api/album/month?y=2014&m=4')
    ).json()) as AlbumMonthResponse;
    expect(body.total).toBe(4);
    expect(body.events.map((e) => e.fileCount)).toEqual([3]);
    expect(body.small.map((e) => e.fileCount)).toEqual([1]);
    expect(body.events[0]?.photos).toHaveLength(3);
    expect((await get(app, '/api/album/month?y=2014&m=13')).status).toBe(400);
    expect((await get(app, '/api/album/month?y=2014')).status).toBe(400);
  });

  test('event: 写真(ページ送り)と前後のできごと。ないものは 404', async () => {
    const { source } = seed();
    const app = createViewerApp(source);
    const month = (await (
      await get(app, '/api/album/month?y=2014&m=4')
    ).json()) as AlbumMonthResponse;
    const id = month.events[0]?.albumEventId as number;
    const body = (await (
      await get(app, `/api/album/event/${id}?order=old&limit=2`)
    ).json()) as AlbumEventResponse;
    expect(body).toMatchObject({ fileCount: 3, limit: 2, offset: 0 });
    expect(body.photos).toHaveLength(2);
    expect(body.previous?.startAt).toBe('2013-04-06T09:00:00');
    expect(body.next?.startAt).toBe('2014-04-20T09:00:00');
    const more = (await (
      await get(app, `/api/album/event/${id}?order=old&limit=2&offset=2`)
    ).json()) as AlbumEventResponse;
    expect(more.photos).toHaveLength(1);
    expect((await get(app, '/api/album/event/999')).status).toBe(404);
    expect((await get(app, '/api/album/event/abc')).status).toBe(404);
  });

  test('memories: 去年の今日(同じ月日の、過去の年)と、今日の一枚(同じ日は同じ 1 枚。salt で別の 1 枚)', async () => {
    const app = createViewerApp(seed().source);
    const body = (await (
      await get(app, '/api/album/memories?date=2014-04-06')
    ).json()) as AlbumMemoriesResponse;
    expect(body.onThisDay.map((e) => e.startAt.slice(0, 4))).toEqual(['2013']);
    expect(body.photoOfDay).not.toBeNull();
    const same = (await (
      await get(app, '/api/album/memories?date=2014-04-06')
    ).json()) as AlbumMemoriesResponse;
    expect(same.photoOfDay?.libraryFileId).toBe(body.photoOfDay?.libraryFileId);
    const other = (await (
      await get(app, '/api/album/memories?date=2014-04-06&salt=1')
    ).json()) as AlbumMemoriesResponse;
    expect(other.photoOfDay?.libraryFileId).not.toBe(
      body.photoOfDay?.libraryFileId
    );
    expect((await get(app, '/api/album/memories?date=2014-13-40')).status).toBe(
      400
    );
    expect((await get(app, '/api/album/memories')).status).toBe(400);
  });
});

describe('GET /api/album/month: できごとに入らない写真', () => {
  test('日付が月までしか分からない写真だけの月でも、写真が出る(できごとは、空)', async () => {
    const source = makeSource();
    const { db } = source.ledger;
    const volume = upsertVolume(db, { volumeUuid: 'v', seenAt: NOW });
    const runId = startRun(db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const add = (n: number, takenAt: string, precision: string): void => {
      const { content } = getOrCreateContent(db, {
        hash: String(n).padStart(64, 'e'),
        sizeBytes: 1,
      });
      db.query(
        `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, width, height)
         VALUES (?, ?, ?, 'filename', 1200, 800)`
      ).run(content.contentId, takenAt, precision);
      insertLibraryFile(db, {
        contentId: content.contentId,
        groupId: insertFileGroup(db, { stem: `m${n}`, bucket: 'md_unknown' }),
        runId,
        relPath: `2009/05/m${n}.jpg`,
        bucket: 'md_unknown',
        thumbRelPath: `${String(n).padStart(2, '0')}/t${n}.jpg`,
        createdAt: NOW,
      });
    };
    add(1, '2009-05', 'month');
    add(2, '2009-05', 'month');
    add(3, '2009-06-01', 'date');
    const body = (await (
      await get(createViewerApp(source), '/api/album/month?y=2009&m=5')
    ).json()) as AlbumMonthResponse;
    expect(body.total).toBe(2);
    expect(body.events).toEqual([]);
    expect(body.small).toEqual([]);
    expect(body.loose.count).toBe(2);
    // 既定は、新しい順(同じ日時なら、あとのものが先)
    expect(body.loose.photos.map((photo) => photo.relPath)).toEqual([
      '2009/05/m2.jpg',
      '2009/05/m1.jpg',
    ]);
    // 別の月の写真は、混ざらない
    const june = (await (
      await get(createViewerApp(source), '/api/album/month?y=2009&m=6')
    ).json()) as AlbumMonthResponse;
    expect(june.loose.count).toBe(1);
  });
});
