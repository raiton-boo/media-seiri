import { browseRuns, getRunDetail, type RunFilter } from '@file-seiri/ledger';
import type { Hono } from 'hono';
import type { RunDetailResponse, RunsResponse } from '../api-types.ts';
import { parseId, parsePage } from './query.ts';
import type { ViewerSource } from './source.ts';

const FILTERS: readonly RunFilter[] = [
  'all',
  'normal',
  'dry-run',
  'interrupted',
];

export const registerRunRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;

  app.get('/api/runs', (context) => {
    const query = context.req.query();
    const filter =
      FILTERS.find((candidate) => candidate === query.filter) ?? 'all';
    const page = parsePage(query);
    const body: RunsResponse = { ...browseRuns(db, filter, page), ...page };
    return context.json(body);
  });

  app.get('/api/runs/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const run = id === undefined ? undefined : getRunDetail(db, id);
    if (!run) return context.json({ error: 'not found' }, 404);
    const body: RunDetailResponse = { run, library: source.library };
    return context.json(body);
  });
};
