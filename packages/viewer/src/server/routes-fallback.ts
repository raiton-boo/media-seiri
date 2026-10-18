import {
  browseDateFallbacks,
  countDateFallbacks,
  DATE_PRECISIONS,
  FALLBACK_SOURCES,
  listSourceVolumes,
} from '@file-seiri/ledger';
import type { Hono } from 'hono';
import type { FallbackResponse } from '../api-types.ts';
import { parseId, parsePage } from './query.ts';
import type { ViewerSource } from './source.ts';

/** `GET /api/fallback`: 日付フォールバック一覧(取得元・日付の精度・ドライブ・実行で絞り込み) */
export const registerFallbackRoutes = (
  app: Hono,
  source: ViewerSource
): void => {
  const { db } = source.ledger;

  app.get('/api/fallback', (context) => {
    const query = context.req.query();
    const dateSource = FALLBACK_SOURCES.find(
      (candidate) => candidate === query.source
    );
    const precision = DATE_PRECISIONS.find(
      (candidate) => candidate === query.precision
    );
    const volumeId = parseId(query.volume);
    const runId = parseId(query.run);
    const page = parsePage(query);
    const body: FallbackResponse = {
      ...browseDateFallbacks(
        db,
        {
          ...(dateSource ? { dateSource } : {}),
          ...(precision ? { precision } : {}),
          ...(volumeId !== undefined ? { volumeId } : {}),
          ...(runId !== undefined ? { runId } : {}),
        },
        page
      ),
      ...page,
      counts: countDateFallbacks(db),
      volumes: listSourceVolumes(db),
    };
    return context.json(body);
  });
};
