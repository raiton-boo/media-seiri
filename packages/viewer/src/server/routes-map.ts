import { countMapPhotos, listMapClusters } from '@file-seiri/ledger';
import type { Context, Hono } from 'hono';
import type { MapClustersResponse, MapConfigResponse } from '../api-types.ts';
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

/** 束ねる格子の、画面上の大きさ(ピクセル) */
const CELL_PIXELS = 56;
/** 地図のタイルの大きさ(MapLibre は、512px) */
const TILE_PIXELS = 512;
const MAX_ZOOM = 22;

/** ズームでの、格子の大きさ(度)。ズームが 1 上がると、半分になる */
export const cellDegreesAt = (zoom: number): number => {
  const clamped = Math.min(
    Math.max(Number.isFinite(zoom) ? zoom : 0, 0),
    MAX_ZOOM
  );
  return (CELL_PIXELS * 360) / (TILE_PIXELS * 2 ** clamped);
};

/**
 * 地図の API(読み取り専用)。
 * - `GET /api/map/config`: 背景地図の設定(提供元・出典)
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
