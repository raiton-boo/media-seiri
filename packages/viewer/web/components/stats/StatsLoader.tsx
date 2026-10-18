'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const StatsLoader = dynamic(
  () => import('./StatsView').then((module) => module.StatsView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
