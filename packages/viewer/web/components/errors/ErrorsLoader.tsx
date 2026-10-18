'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため。静的書き出しで、待って止まらないように) */
export const ErrorsLoader = dynamic(
  () => import('./ErrorsView').then((module) => module.ErrorsView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
