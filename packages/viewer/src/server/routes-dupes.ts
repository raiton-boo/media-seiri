import {
  browseDuplicateGroups,
  getDuplicateGroup,
  listRunSummaries,
  listSourceVolumes,
} from '@file-seiri/ledger';
import type { Hono } from 'hono';
import type { DupeDetailResponse, DupesResponse } from '../api-types.ts';
import { parseId, parsePage } from './query.ts';
import type { ViewerSource } from './source.ts';

/** 実行の選択肢に出す数 */
const RUN_OPTIONS = 100;

/** `GET /api/dupes`・`/api/dupes/:id`: 重複のグループの一覧と、採用側・スキップ側の比較 */
export const registerDupeRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;

  app.get('/api/dupes', (context) => {
    const query = context.req.query();
    const volumeId = parseId(query.volume);
    const runId = parseId(query.run);
    const page = parsePage(query);
    const { total, totalSkipped, items } = browseDuplicateGroups(
      db,
      {
        ...(volumeId !== undefined ? { volumeId } : {}),
        ...(runId !== undefined ? { runId } : {}),
        ...(query.q ? { query: query.q } : {}),
      },
      page
    );
    const body: DupesResponse = {
      total,
      totalSkipped,
      ...page,
      items,
      volumes: listSourceVolumes(db),
      runs: listRunSummaries(db, RUN_OPTIONS),
    };
    return context.json(body);
  });

  app.get('/api/dupes/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const detail = id === undefined ? undefined : getDuplicateGroup(db, id);
    if (!detail) return context.json({ error: 'not found' }, 404);
    const body: DupeDetailResponse = detail;
    return context.json(body);
  });
};
