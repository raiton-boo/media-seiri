'use client';

import dynamic from 'next/dynamic';
import { DashboardSkeleton } from './DashboardSkeleton';

/**
 * ダッシュボードは、ブラウザ側だけで描画する(データは、API から取るため)。
 * 静的書き出しのとき(サーバー側の描画)は、スケルトンだけを書き出す(データを待って、止まらないように)。
 */
export const DashboardLoader = dynamic(
  () => import('./DashboardView').then((module) => module.DashboardView),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
