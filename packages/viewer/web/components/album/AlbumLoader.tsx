'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const AlbumLoader = dynamic(
  () => import('./AlbumView').then((module) => module.AlbumView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
