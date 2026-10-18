'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const FallbackLoader = dynamic(
  () => import('./FallbackView').then((module) => module.FallbackView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
