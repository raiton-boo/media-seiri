'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(地図は、ブラウザの機能(WebGL)で動く) */
export const MapLoader = dynamic(
  () => import('./MapView').then((module) => module.MapView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
