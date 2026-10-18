import { getLibraryStats } from '@file-seiri/ledger';
import type { Hono } from 'hono';
import type { StatsResponse } from '../api-types.ts';
import { albumFilterOf } from './filter.ts';
import { parseId } from './query.ts';
import type { ViewerSource } from './source.ts';

/**
 * 統計の API(読み取り専用)。
 * - `GET /api/stats?monthsYear=`: 期間別(月別は、`year` の年。省くと、いちばん新しい年)・カメラ別・撮影時間帯・全体の概要。絞り込み・検索の条件が、すべてに効く。
 */
export const registerStatsRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;
  app.get('/api/stats', (context) => {
    // 月別に出す年。`year` は、絞り込み(年)の名前なので、使わない
    const year = parseId(context.req.query('monthsYear'));
    const body: StatsResponse = getLibraryStats(
      db,
      albumFilterOf(db, context),
      year !== undefined && year >= 1 && year <= 9999 ? year : undefined
    );
    return context.json(body);
  });
};
