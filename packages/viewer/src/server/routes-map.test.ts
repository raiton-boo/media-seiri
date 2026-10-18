import { describe, expect, test } from 'bun:test';
import {
  getOrCreateContent,
  insertFileGroup,
  insertLibraryFile,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { Hono } from 'hono';
import type {
  MapClustersResponse,
  MapConfigResponse,
  MapPlacesResponse,
} from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { parseAlbumFilter, parseBbox } from './query.ts';
import {
  cellDegreesAt,
  mapTileSource,
  registerMapRoutes,
} from './routes-map.ts';
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
  const add = (
    rel: string,
    lat: number | null,
    lon: number | null,
    n: number
  ) => {
    const { content } = getOrCreateContent(db, {
      hash: String(n).padStart(64, 'e'),
      sizeBytes: 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, gps_lat, gps_lon, width, height)
       VALUES (?, '2024-03-05T10:00:00', 'full', 'exif', ?, ?, 10, 10)`
    ).run(content.contentId, lat, lon);
    insertLibraryFile(db, {
      contentId: content.contentId,
      groupId: insertFileGroup(db, { stem: rel, bucket: 'full' }),
      runId,
      relPath: rel,
      bucket: 'full',
      createdAt: NOW,
    });
  };
  add('a.jpg', 35.68, 139.76, 1);
  add('b.jpg', 35.69, 139.77, 2);
  add('c.jpg', 43.06, 141.35, 3);
  add('d.jpg', null, null, 4);
  return source;
};

describe('parseBbox・cellDegreesAt', () => {
  test('範囲: 南,西,北,東。不正な値は、undefined', () => {
    expect(parseBbox('35,139,36,140')).toEqual({
      south: 35,
      west: 139,
      north: 36,
      east: 140,
    });
    expect(parseBbox('36,139,35,140')).toBeUndefined();
    expect(parseBbox('35,139,36')).toBeUndefined();
    expect(parseBbox('a,b,c,d')).toBeUndefined();
    expect(parseBbox('-91,0,0,0')).toBeUndefined();
    expect(parseBbox(undefined)).toBeUndefined();
  });
  test('絞り込みの条件としての範囲(bbox)も、カンマを割らずに読む', () => {
    expect(
      parseAlbumFilter((name) => ({ bbox: ['35,139,36,140'] })[name])
    ).toEqual({
      bbox: { south: 35, west: 139, north: 36, east: 140 },
    });
    expect(parseAlbumFilter((name) => ({ bbox: ['1,2,3'] })[name])).toEqual({});
  });

  test('格子は、ズームが 1 上がるごとに、半分', () => {
    expect(cellDegreesAt(3) / cellDegreesAt(4)).toBeCloseTo(2);
    // 近づくと、格子の大きさ(ピクセル)も、細かくなる(同じズームの変化で、半分より多く縮む)
    expect(cellDegreesAt(12) / cellDegreesAt(13)).toBeGreaterThan(2);
    expect(cellDegreesAt(Number.NaN)).toBe(cellDegreesAt(0));
    expect(cellDegreesAt(99)).toBe(cellDegreesAt(22));
  });
});

describe('/api/map', () => {
  test('clusters: ズームが低いと束ね、高いと別々。範囲の外は、含めない。GPS なしの枚数', async () => {
    const app = createViewerApp(seed());
    const clusters = async (query: string) =>
      (await (
        await get(app, `/api/map/clusters${query}`)
      ).json()) as MapClustersResponse;
    const world = '?view=-90,-180,90,180';
    const low = await clusters(`${world}&zoom=3`);
    expect(low.clusters.map((c) => c.count)).toEqual([2, 1]);
    expect(low).toMatchObject({ total: 3, withGps: 3, withoutGps: 1 });
    expect((await clusters(`${world}&zoom=16`)).clusters).toHaveLength(3);
    // 東京の範囲だけ
    expect((await clusters('?view=35,139,36,140&zoom=3')).total).toBe(2);
    // 写真の一覧にも、範囲が効く(地図の「この範囲の写真」)
    const inTokyo = (await (
      await get(app, '/api/album/search/photos?bbox=35,139,36,140')
    ).json()) as { total: number };
    expect(inTokyo.total).toBe(2);
    // 絞り込みの条件(種別)が効く: 写真だけ → 動画なし
    expect((await clusters(`${world}&zoom=3&kind=video`)).total).toBe(0);
    expect((await get(app, '/api/map/clusters')).status).toBe(400);
  });

  test('places: 地名を探して、動かす範囲と枚数を返す。写真のない地域も、動かせる', async () => {
    const app = createViewerApp(seed());
    const places = async (q: string) =>
      (
        (await (
          await get(app, `/api/map/places?q=${encodeURIComponent(q)}`)
        ).json()) as MapPlacesResponse
      ).places;
    const tokyo = (await places('東京')).find(
      (place) => place.ref === 'pref:40'
    );
    expect(tokyo).toMatchObject({ label: '東京都', count: 2 });
    expect(tokyo?.bounds.south).toBeLessThan(tokyo?.bounds.north ?? 0);
    const paris = (await places('パリ')).find((place) =>
      place.label.startsWith('パリ')
    );
    expect(paris?.count).toBe(0);
    expect(await places('')).toEqual([]);
  });

  test('config: 既定は地理院タイル。設定で OpenStreetMap。知らない値は、既定', () => {
    expect(mapTileSource(undefined).label).toBe('地理院タイル(標準地図)');
    expect(mapTileSource('osm').attribution).toContain('OpenStreetMap');
    expect(mapTileSource('xyz')).toEqual(mapTileSource('gsi'));
  });

  test('config の API', async () => {
    const app = new Hono();
    registerMapRoutes(app, makeSource(), { FILE_SEIRI_MAP_TILES: 'osm' });
    const body = (await (
      await app.request('/api/map/config')
    ).json()) as MapConfigResponse;
    expect(body.tileUrl).toContain('tile.openstreetmap.org');
  });
});
