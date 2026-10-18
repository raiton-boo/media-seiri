import { describe, expect, test } from 'bun:test';
import { areaLabel, nearestCity } from '@file-seiri/core';
import {
  getOrCreateContent,
  insertFileGroup,
  insertLibraryFile,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import type {
  AlbumSectionPhotosResponse,
  AlbumSectionsResponse,
  AreaLabelsResponse,
  AutoAlbumsResponse,
  CalendarDayResponse,
  CalendarResponse,
  SearchPhotosResponse,
  SearchSuggestResponse,
} from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { parseAlbumFilter } from './query.ts';
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
  const add = (
    rel: string,
    takenAt: string | null,
    camera: string | null,
    gps = false
  ) => {
    n += 1;
    const { content } = getOrCreateContent(db, {
      hash: String(n).padStart(64, 'c'),
      sizeBytes: 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, camera_model, gps_lat, gps_lon, width, height)
       VALUES (?, ?, ?, 'exif', ?, ?, ?, 1200, 800)`
    ).run(
      content.contentId,
      takenAt,
      takenAt ? 'full' : 'none',
      camera,
      gps ? 35 : null,
      gps ? 139 : null
    );
    insertLibraryFile(db, {
      contentId: content.contentId,
      groupId: insertFileGroup(db, { stem: rel, bucket: 'full' }),
      runId,
      relPath: rel,
      bucket: 'full',
      thumbRelPath: `${String(n).padStart(2, '0')}/t${n}.jpg`,
      createdAt: NOW,
    });
  };
  add('a.jpg', '2024-03-05T10:00:00', 'Canon', true);
  add('b.mp4', '2024-03-06T10:00:00', 'Canon');
  add('c.jpg', '2023-12-31T10:00:00', null);
  add('d.jpg', null, null);
  return source;
};

describe('parseAlbumFilter', () => {
  const parse = (query: Record<string, string[]>) =>
    parseAlbumFilter((name) => query[name]);
  test('種別・年・精度・取得元・ドライブ・GPS・カメラを読む。不正な値は、無視する', () => {
    expect(
      parse({
        kind: ['photo,video', 'bogus'],
        year: ['2014', 'x'],
        precision: ['date', 'bogus'],
        source: ['json'],
        volume: ['3'],
        gps: ['1'],
        camera: ['Canon IXY, Digital', '不明'],
      })
    ).toEqual({
      kinds: ['photo', 'video'],
      years: [2014],
      precisions: ['date'],
      dateSources: ['json'],
      volumeIds: [3],
      gps: true,
      cameras: ['Canon IXY, Digital', '不明'],
    });
    expect(parse({})).toEqual({});
    expect(parse({ gps: ['0'] })).toEqual({ gps: false });
    expect(parse({ gps: ['2'] })).toEqual({});
  });
});

describe('/api/album/all', () => {
  test('sections: 区画(新しい順・古い順)と、全体の枚数。日付なしは、最後', async () => {
    const app = createViewerApp(seed());
    const body = (await (
      await get(app, '/api/album/all/sections')
    ).json()) as AlbumSectionsResponse;
    expect(body.total).toBe(4);
    expect(body.sections).toEqual([
      { year: 2024, month: 3, count: 2 },
      { year: 2023, month: 12, count: 1 },
      { year: 0, month: 0, count: 1 },
    ]);
    const old = (await (
      await get(app, '/api/album/all/sections?order=old')
    ).json()) as AlbumSectionsResponse;
    expect(old.sections.map((s) => s.year)).toEqual([2023, 2024, 0]);
  });

  test('絞り込みの条件が、区画にも、写真にも、効く', async () => {
    const app = createViewerApp(seed());
    const sections = (await (
      await get(app, '/api/album/all/sections?kind=video')
    ).json()) as AlbumSectionsResponse;
    expect(sections).toMatchObject({
      total: 1,
      sections: [{ year: 2024, month: 3, count: 1 }],
    });
    const photos = (await (
      await get(app, '/api/album/all/photos?y=2024&m=3&camera=Canon&gps=1')
    ).json()) as AlbumSectionPhotosResponse;
    expect(photos.photos.map((p) => p.relPath)).toEqual(['a.jpg']);
  });

  test('photos: 区画の写真(撮影の順)。日付なし(y=0&m=0)も取れる。y・m が不正なら 400', async () => {
    const app = createViewerApp(seed());
    const body = (await (
      await get(app, '/api/album/all/photos?y=2024&m=3&order=old')
    ).json()) as AlbumSectionPhotosResponse;
    expect(body.photos.map((p) => p.relPath)).toEqual(['a.jpg', 'b.mp4']);
    expect(body.photos[1]).toMatchObject({
      kind: 'video',
      thumbRelPath: expect.any(String),
    });
    const undated = (await (
      await get(app, '/api/album/all/photos?y=0&m=0')
    ).json()) as AlbumSectionPhotosResponse;
    expect(undated.photos.map((p) => p.relPath)).toEqual(['d.jpg']);
    expect((await get(app, '/api/album/all/photos?y=2024')).status).toBe(400);
    expect((await get(app, '/api/album/all/photos?y=2024&m=13')).status).toBe(
      400
    );
    expect((await get(app, '/api/album/all/photos')).status).toBe(400);
  });
});

describe('検索', () => {
  test('parseAlbumFilter: 日付はそろえ、場所は格子に丸め、不正な値は無視', () => {
    const parse = (query: Record<string, string[]>) =>
      parseAlbumFilter((name) => query[name]);
    expect(
      parse({
        date: ['2014年4月', 'x', '2014-04'],
        name: ['a,b', ''],
        place: ['35.04:139.96', 'x:y', '99:0'],
      })
    ).toEqual({
      dates: ['2014-04'],
      names: ['a,b'],
      places: [{ lat: 35, lon: 140 }],
    });
  });

  test('suggest: 候補と件数。photos: 合う枚数と、先頭から', async () => {
    const app = createViewerApp(seed());
    const suggest = (await (
      await get(app, '/api/album/search/suggest?q=2024-03')
    ).json()) as SearchSuggestResponse;
    expect(suggest.suggestions).toEqual([
      { type: 'date', value: '2024-03', label: '2024年3月', count: 2 },
    ]);
    const found = (await (
      await get(app, '/api/album/search/photos?name=.jpg&limit=2')
    ).json()) as SearchPhotosResponse;
    expect(found).toMatchObject({ total: 3, limit: 2, offset: 0 });
    expect(found.photos).toHaveLength(2);
  });
});

describe('地名(地域)の検索', () => {
  // 試験データの GPS(北緯 35 度・東経 139 度)の、近くの地名
  const city = nearestCity(35, 139) as NonNullable<
    ReturnType<typeof nearestCity>
  >;

  test('入力が空: よく撮った地域(地名・都道府県・国)を、件数つきで出す。座標の候補は、出さない', async () => {
    const app = createViewerApp(seed());
    const body = (await (
      await get(app, '/api/album/search/suggest?q=')
    ).json()) as SearchSuggestResponse;
    const areas = body.suggestions.filter((item) => item.type === 'area');
    expect(areas).toContainEqual({
      type: 'area',
      value: `city:${city.id}`,
      label: areaLabel(`city:${city.id}`) as string,
      count: 1,
    });
    expect(areas.map((item) => item.value)).toContain('country:JP');
    expect(body.suggestions.some((item) => item.type === 'place')).toBe(false);
  });

  test('名前で探す: 国名・都道府県。写真のない地域は、出さない', async () => {
    const app = createViewerApp(seed());
    const suggest = async (q: string) =>
      (
        (await (
          await get(app, `/api/album/search/suggest?q=${encodeURIComponent(q)}`)
        ).json()) as SearchSuggestResponse
      ).suggestions;
    expect(await suggest('日本')).toContainEqual({
      type: 'area',
      value: 'country:JP',
      label: '日本',
      count: 1,
    });
    expect(await suggest('フランス')).toEqual([]);
  });

  test('area の条件: その地域の写真だけ。ほかの国は、0 枚。不正な指定は、無視', async () => {
    const app = createViewerApp(seed());
    const total = async (query: string) =>
      (
        (await (
          await get(app, `/api/album/search/photos${query}`)
        ).json()) as SearchPhotosResponse
      ).total;
    expect(await total(`?area=city:${city.id}`)).toBe(1);
    expect(await total('?area=country:JP')).toBe(1);
    expect(await total('?area=country:FR')).toBe(0);
    expect(await total('?area=bogus')).toBe(4);
  });

  test('札の名前と、拡大表示の地名', async () => {
    const source = seed();
    const app = createViewerApp(source);
    const labels = (await (
      await get(app, '/api/album/areas?area=pref:40&area=country:JP&area=bogus')
    ).json()) as AreaLabelsResponse;
    expect(labels.labels).toEqual({
      'pref:40': '東京都',
      'country:JP': '日本',
    });
  });
});

describe('カレンダー', () => {
  test('calendar: 年の一覧と日ごとの枚数(年を省くと、最新の年。条件が効く)', async () => {
    const app = createViewerApp(seed());
    const calendar = async (query: string) =>
      (await (
        await get(app, `/api/album/calendar${query}`)
      ).json()) as CalendarResponse;
    expect(await calendar('')).toMatchObject({
      year: 2024,
      years: [
        { year: 2024, count: 2 },
        { year: 2023, count: 1 },
      ],
      days: [
        { date: '2024-03-05', count: 1 },
        { date: '2024-03-06', count: 1 },
      ],
      total: 2,
    });
    expect((await calendar('?y=2023')).days).toEqual([
      { date: '2023-12-31', count: 1 },
    ]);
    expect((await calendar('?kind=video')).days).toEqual([
      { date: '2024-03-06', count: 1 },
    ]);
    expect(await calendar('?y=1999')).toMatchObject({
      year: 1999,
      days: [],
      total: 0,
    });
  });

  test('day: 選んだ日のまとめ。不正な日付は 400', async () => {
    const app = createViewerApp(seed());
    const body = (await (
      await get(app, '/api/album/day?day=2024-03-05')
    ).json()) as CalendarDayResponse;
    expect(body).toEqual({
      date: '2024-03-05',
      count: 1,
      firstClock: '10:00',
      lastClock: '10:00',
      gpsCount: 1,
    });
    expect((await get(app, '/api/album/day?day=2024-3-5')).status).toBe(400);
  });
});

describe('自動アルバム', () => {
  test('auto: できごとと、切り口(件数・条件)。live=1 の条件も読める', async () => {
    const app = createViewerApp(seed());
    const body = (await (
      await get(app, '/api/album/auto')
    ).json()) as AutoAlbumsResponse;
    expect(body.eventTotal).toBe(0);
    expect(body.events).toEqual([]);
    // 日付なしの 1 枚だけ(ほかは、日時まで分かる)
    expect(body.dateGaps).toEqual([
      {
        key: 'none',
        label: '日付なし',
        precisions: ['none', 'invalid'],
        count: 1,
      },
    ]);
    expect(body.albums.find((album) => album.title === '動画')).toMatchObject({
      kind: 'video',
      count: 1,
      unit: '本',
      filter: { kinds: ['video'] },
    });
    const live = parseAlbumFilter((name) => ({ live: ['1'] })[name]);
    expect(live).toEqual({ livePhotos: true });
    expect(parseAlbumFilter((name) => ({ live: ['0'] })[name])).toEqual({});
  });
});
