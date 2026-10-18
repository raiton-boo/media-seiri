'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const AutoAlbumsLoader = dynamic(
  () => import('./AutoAlbumsView').then((module) => module.AutoAlbumsView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
