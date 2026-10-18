'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const RunsLoader = dynamic(
  () => import('./RunsView').then((module) => module.RunsView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
