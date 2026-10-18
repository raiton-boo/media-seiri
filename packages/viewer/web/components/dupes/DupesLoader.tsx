'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const DupesLoader = dynamic(
  () => import('./DupesView').then((module) => module.DupesView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
