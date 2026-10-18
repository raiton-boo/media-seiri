'use client';

import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useMapConfig } from '../../lib/api';

const ZOOM = 12;
/** 地図の画面に移ったとき、この写真の場所を、真ん中にして、近づける */
const MAP_ZOOM_ON_OPEN = 15;

type Props = { lat: number; lon: number };

/**
 * 拡大表示の、ミニ地図(GPS の場所の 1 点)。動かせない小さな地図で、押すと、地図の画面で、その場所を開く。
 * 背景は、オンラインの地図タイル。作れない(ネットなし・WebGL なし)ときは、何も出さない(座標は、別に出ている)。
 */
export function MiniMap({ lat, lon }: Props) {
  const config = useMapConfig();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const tileUrl = config.data?.tileUrl;
  const maxZoom = config.data?.maxZoom;

  useEffect(() => {
    if (!container.current || !tileUrl || maxZoom === undefined) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: container.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: 'raster',
              tiles: [tileUrl],
              tileSize: 256,
              maxzoom: maxZoom,
            },
          },
          layers: [{ id: 'base', type: 'raster', source: 'base' }],
        },
        center: [lon, lat],
        zoom: ZOOM,
        interactive: false,
        attributionControl: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    const pin = document.createElement('div');
    pin.className = 'mk-pin';
    new Marker({ element: pin, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .addTo(map);
    return () => map.remove();
  }, [lat, lon, tileUrl, maxZoom]);

  if (failed) return null;
  return (
    <Link
      className="mini-map"
      draggable={false}
      aria-label="地図で、この場所を開く"
      href={`/map?c=${lat.toFixed(5)},${lon.toFixed(5)}&z=${MAP_ZOOM_ON_OPEN}`}
    >
      <div ref={container} className="mini-map-canvas" />
    </Link>
  );
}
