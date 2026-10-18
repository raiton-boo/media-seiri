import { areaBounds, areaLabel, searchAreas } from '@file-seiri/core';
import {
  countFilteredPhotos,
  countMapPhotos,
  listMapClusters,
} from '@file-seiri/ledger';
import type { Context, Hono } from 'hono';
import type {
  MapClustersResponse,
  MapConfigResponse,
  MapPlacesResponse,
} from '../api-types.ts';
import { withAreas } from './areas.ts';
import { albumFilterOf } from './filter.ts';
import { parseBbox } from './query.ts';
import type { ViewerSource } from './source.ts';

/** 背景地図の提供元(設定で選ぶ)。既定は、国土地理院の地理院タイル(撮影場所が、日本国内だけのため) */
const TILE_SOURCES: Record<string, MapConfigResponse> = {
  gsi: {
    tileUrl: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attribution: '国土地理院 / 地理院タイル',
    label: '地理院タイル(標準地図)',
    maxZoom: 18,
  },
  osm: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    label: 'OpenStreetMap',
    maxZoom: 19,
  },
};

/** 設定(環境変数 `FILE_SEIRI_MAP_TILES`: `gsi` か `osm`)で、提供元を選ぶ。知らない値は、既定 */
export const mapTileSource = (name: string | undefined): MapConfigResponse =>
  TILE_SOURCES[name ?? ''] ?? (TILE_SOURCES.gsi as MapConfigResponse);

/**
 * 束ねる格子の、画面上の大きさ(ピクセル)。遠いときは、印が重ならない大きさ。近づくほど、細かく(別々の場所のピンが、早めに分かれる)。
 * 同じ位置の写真は、どれだけ近づいても、1 つに束ねる(札で、まとめて見せる)。
 */
const cellPixelsAt = (zoom: number): number =>
  zoom >= 15 ? 14 : zoom >= 13 ? 24 : 40;
/** 地図のタイルの大きさ(MapLibre は、512px) */
const TILE_PIXELS = 512;
const MAX_ZOOM = 22;
/** 場所の検索の、入力の長さの上限と、返す件数 */
const MAX_QUERY_LENGTH = 100;
const MAX_PLACES = 8;

/** ズームでの、格子の大きさ(度)。ズームが 1 上がると、半分になる */
export const cellDegreesAt = (zoom: number): number => {
  const clamped = Math.min(
    Math.max(Number.isFinite(zoom) ? zoom : 0, 0),
    MAX_ZOOM
  );
  return (cellPixelsAt(clamped) * 360) / (TILE_PIXELS * 2 ** clamped);
};

/**
 * 地図の API(読み取り専用)。
 * - `GET /api/map/config`: 背景地図の設定(提供元・出典)
 * - `GET /api/map/places?q=`: 場所(地名)の検索。地図を動かす範囲と、その中の写真の枚数
 * - `GET /api/map/clusters?view=南,西,北,東&zoom=`: 表示範囲のまとまり(絞り込み・検索の条件つき)
 */
export const registerMapRoutes = (
  app: Hono,
  source: ViewerSource,
  env: Record<string, string | undefined> = process.env
): void => {
  const { db } = source.ledger;
  const filterOf = (context: Context) => albumFilterOf(db, context);

  app.get('/api/map/config', (context) => {
    const body: MapConfigResponse = mapTileSource(env.FILE_SEIRI_MAP_TILES);
    return context.json(body);
  });

  // 場所の指定: 地名(市区町村・都道府県・国)を探して、地図を動かす範囲と、その中の写真の枚数
  app.get('/api/map/places', (context) => {
    const text = (context.req.query('q') ?? '').slice(0, MAX_QUERY_LENGTH);
    const places = searchAreas(text, MAX_PLACES).flatMap((ref) => {
      const label = areaLabel(ref);
      const bounds = areaBounds(ref);
      if (!label || !bounds) return [];
      return [
        {
          ref,
          label,
          bounds,
          count: countFilteredPhotos(db, withAreas(db, {}, [ref])),
        },
      ];
    });
    const body: MapPlacesResponse = { places };
    return context.json(body);
  });

  app.get('/api/map/clusters', (context) => {
    const bbox = parseBbox(context.req.query('view'));
    if (!bbox) return context.json({ error: 'bad view' }, 400);
    const zoom = Number(context.req.query('zoom'));
    const { clusters, total } = listMapClusters(
      db,
      { ...filterOf(context), bbox },
      cellDegreesAt(zoom)
    );
    const body: MapClustersResponse = {
      clusters,
      total,
      ...countMapPhotos(db),
    };
    return context.json(body);
  });
};
