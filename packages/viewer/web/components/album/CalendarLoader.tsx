'use client';

import dynamic from 'next/dynamic';
import { ListSkeleton } from '../ListSkeleton';

/** ブラウザ側だけで描画する(データは API から取るため) */
export const CalendarLoader = dynamic(
  () => import('./CalendarView').then((module) => module.CalendarView),
  { ssr: false, loading: () => <ListSkeleton /> }
);
