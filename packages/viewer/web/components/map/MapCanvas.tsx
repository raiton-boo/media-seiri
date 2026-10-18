'use client';

import type { MapCluster } from '@file-seiri/ledger';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { MapConfigResponse } from '../../../src/api-types.ts';
import { formatCount } from '../../lib/format';
import { type Bounds, clusterSize, clusterTone } from '../../lib/map';
import { Button } from '../Button';

export type MapView = {
  bounds: Bounds;
  zoom: number;
  center: { lat: number; lon: number };
};

type Props = {
  config: MapConfigResponse;
  /** 最初の位置(中心・ズーム) */
  initial: { lat: number; lon: number; zoom: number };
  clusters: MapCluster[];
  /** 動かし終えた(表示範囲・ズームが変わった) */
  onViewChange: (view: MapView) => void;
  /** まとまり・ピンを押した */
  onSelect: (cluster: MapCluster) => void;
  /** この範囲へ、動かす(`key` が変わるたびに) */
  fit?: { bounds: Bounds; key: number };
  /** 押した位置の印(選択中)を強調する */
  selected?: MapCluster;
  /** 地図の上に重ねるもの(押した場所の写真の札など) */
  children?: ReactNode;
};

/** 範囲へ動かすときの、余白(px)と、いちばん近づく上限(ズーム) */
const FIT_PADDING = 80;
const FIT_MAX_ZOOM = 17;

const currentView = (map: MapLibreMap): MapView => {
  const bounds = map.getBounds();
  const center = map.getCenter();
  return {
    bounds: {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
    },
    zoom: map.getZoom(),
    center: { lat: center.lat, lon: center.lng },
  };
};

/** まとまり(件数の円)・ピン(1 枚)の、DOM の要素 */
const markerElement = (cluster: MapCluster, selected: boolean): HTMLElement => {
  const element = document.createElement('button');
  element.type = 'button';
  if (cluster.count === 1) {
    element.className = `mk-pin${selected ? ' sel' : ''}`;
    element.setAttribute('aria-label', '1 枚');
  } else {
    const size = clusterSize(cluster.count);
    element.className = `mk-cluster ${clusterTone(cluster.count)}${selected ? ' sel' : ''}`;
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.fontSize = `${Math.round(size / 3.2)}px`;
    element.textContent = formatCount(cluster.count);
    element.setAttribute('aria-label', `${cluster.count} 枚のまとまり`);
  }
  return element;
};

/**
 * 地図(MapLibre GL JS)。背景は、オンラインの地図タイル(設定で提供元を選ぶ)。ネットに未接続なら、背景なしで、ピンだけ。
 * まとまり(件数)・ピンは、サーバーが、表示範囲とズームに応じて束ねたものを、DOM の印で重ねる。
 */
export function MapCanvas({
  config,
  initial,
  clusters,
  onViewChange,
  onSelect,
  fit,
  selected,
  children,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  // コールバックは、最新のものを使う(地図は、1 回だけ作る)
  const callbacks = useRef({ onViewChange, onSelect });
  callbacks.current = { onViewChange, onSelect };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 地図は、最初に 1 回だけ作る(位置・設定は、そのときの値)
  useEffect(() => {
    if (!container.current) return;
    let created: MapLibreMap;
    try {
      created = new MapLibreMap({
        container: container.current,
        style: {
          version: 8,
          // 背景は、地図のタイルだけ(タイルが読めなければ、後ろの CSS の格子が見える)
          sources: {
            base: {
              type: 'raster',
              tiles: [config.tileUrl],
              tileSize: 256,
              maxzoom: config.maxZoom,
            },
          },
          layers: [{ id: 'base', type: 'raster', source: 'base' }],
        },
        center: [initial.lon, initial.lat],
        zoom: initial.zoom,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        maxZoom: config.maxZoom + 3,
      });
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : '地図を作れませんでした'
      );
      return;
    }
    created.touchZoomRotate.disableRotation();
    created.on('moveend', () =>
      callbacks.current.onViewChange(currentView(created))
    );
    created.on('load', () =>
      callbacks.current.onViewChange(currentView(created))
    );
    created.on('error', (event) => {
      if ((event as { sourceId?: string }).sourceId === 'base')
        setTilesFailed(true);
    });
    created.on('sourcedata', (event) => {
      if (event.sourceId === 'base' && 'tile' in event && event.tile)
        setTilesFailed(false);
    });
    map.current = created;
    return () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
      created.remove();
      map.current = null;
    };
  }, []);

  // まとまりの印を、置き直す
  useEffect(() => {
    const current = map.current;
    if (!current) return;
    for (const marker of markers.current) marker.remove();
    markers.current = clusters.map((cluster) => {
      const isSelected =
        selected !== undefined &&
        selected.libraryFileId === cluster.libraryFileId &&
        selected.count === cluster.count;
      const element = markerElement(cluster, isSelected);
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        callbacks.current.onSelect(cluster);
      });
      return new Marker({
        element,
        // ピンの先が、位置。円は、中心が位置
        anchor: cluster.count === 1 ? 'bottom' : 'center',
      })
        .setLngLat([cluster.lon, cluster.lat])
        .addTo(current);
    });
  }, [clusters, selected]);

  // 範囲へ動かす
  const fitKey = fit?.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 動かすのは、key が変わったときだけ
  useEffect(() => {
    const current = map.current;
    if (!current || !fit) return;
    current.fitBounds(
      [
        [fit.bounds.west, fit.bounds.south],
        [fit.bounds.east, fit.bounds.north],
      ],
      { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: 600 }
    );
  }, [fitKey]);

  return (
    <div className="map-box">
      <div ref={container} className="map-canvas" />
      {failed ? (
        <div className="map-fail mono">
          この環境では、地図を表示できません({failed}
          )。右の一覧と、アルバムを使ってください。
        </div>
      ) : null}
      <div className="map-zoom">
        <Button ariaLabel="拡大" onClick={() => map.current?.zoomIn()}>
          ＋
        </Button>
        <Button ariaLabel="縮小" onClick={() => map.current?.zoomOut()}>
          －
        </Button>
      </div>
      {children}
      <div className="chip y map-source">背景: {config.label}</div>
      <div className="map-credit mono">
        <span>出典: {config.attribution}</span>
        <span>
          {tilesFailed
            ? 'ネットに未接続のため、背景なし(ピンと座標の一覧のみ)'
            : 'ネットに未接続の場合は、背景なし(ピンと座標の一覧のみ)'}
        </span>
      </div>
    </div>
  );
}
