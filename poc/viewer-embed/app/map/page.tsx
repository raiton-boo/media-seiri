'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

type TileProvider = {
  tiles: string;
  attribution: string;
  maxZoom: number;
};

// 提供元ごとの設定。出典の表示は、各提供元の利用条件で求められている
const TILE_PROVIDERS: Record<string, TileProvider> = {
  gsi: {
    tiles: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
    maxZoom: 18,
  },
  osm: {
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
};
const DEFAULT_PROVIDER = 'gsi';

// 試作のピン(東京駅・京都駅・大阪駅)。[経度, 緯度] の順
const PINS: [number, number][] = [
  [139.7671, 35.6812],
  [135.7585, 34.9858],
  [135.4959, 34.7025],
];
const INITIAL_CENTER: [number, number] = [137.0, 35.2];
const INITIAL_ZOOM = 5;
const TILE_SIZE = 256;
// Worker の場所(scripts/copy-worker.ts が、この名前でコピーする)
const WORKER_URL = '/maplibre-gl-worker.mjs';

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [providerName, setProviderName] = useState(DEFAULT_PROVIDER);
  const [status, setStatus] = useState('地図を読み込み中...');

  useEffect(() => {
    // 静的書き出しでは、ページを実行時の URL で切り替えられないため、画面の側で指定を読む
    const requested =
      new URLSearchParams(window.location.search).get('provider') ??
      DEFAULT_PROVIDER;
    const name = requested in TILE_PROVIDERS ? requested : DEFAULT_PROVIDER;
    const provider = TILE_PROVIDERS[name];
    if (!provider) return;
    setProviderName(name);

    let createdMap: import('maplibre-gl').Map | undefined;
    let isCancelled = false;

    const initializeMap = async () => {
      // maplibre-gl は読み込み時にブラウザの機能を使うため、静的書き出しの段階では読み込まない
      const maplibregl = await import('maplibre-gl');
      maplibregl.setWorkerUrl(WORKER_URL);
      if (isCancelled || !containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: 'raster',
              tiles: [provider.tiles],
              tileSize: TILE_SIZE,
              attribution: provider.attribution,
              maxzoom: provider.maxZoom,
            },
          },
          layers: [{ id: 'base', type: 'raster', source: 'base' }],
        },
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
      });
      createdMap = map;

      for (const pin of PINS) {
        new maplibregl.Marker().setLngLat(pin).addTo(map);
      }
      map.on('load', () => setStatus('地図を表示中'));
      // タイルを取得できないとき(ネットに未接続など)も、画面は壊さず、お知らせだけ出す
      map.on('error', () =>
        setStatus(
          '地図の背景を取得できません(ネットに未接続の可能性)。ピンは表示されます'
        )
      );
      // タイルを取得できたら、お知らせを元に戻す(ネットに再接続したときのため)
      map.on('sourcedata', (event) => {
        if (event.tile) setStatus('地図を表示中');
      });
    };
    initializeMap();

    return () => {
      isCancelled = true;
      createdMap?.remove();
    };
  }, []);

  return (
    <main>
      <h1>地図の試作(提供元: {providerName})</h1>
      <p>{status}</p>
      <div ref={containerRef} style={{ width: '100%', height: '70vh' }} />
      <p>
        <a href="/map?provider=gsi">国土地理院</a> /{' '}
        <a href="/map?provider=osm">OpenStreetMap</a> / <a href="/">トップへ</a>
      </p>
    </main>
  );
}
