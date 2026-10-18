import {
  browseErrors,
  countErrorCodes,
  getBrowsedError,
  listRepairAttempts,
  listRunSummaries,
} from '@file-seiri/ledger';
import type { Hono } from 'hono';
import type { ErrorDetailResponse, ErrorsResponse } from '../api-types.ts';
import { parseId, parsePage } from './query.ts';
import type { ViewerSource } from './source.ts';

/** 実行の選択肢に出す数 */
const RUN_OPTIONS = 100;

/** CSV の 1 項目(カンマ・改行・引用符を含むときは、引用符で囲む) */
const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const filterOf = (query: { code?: string; run?: string }) => ({
  ...(query.code ? { code: query.code } : {}),
  ...(parseId(query.run) !== undefined ? { runId: parseId(query.run) } : {}),
});

export const registerErrorRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;

  app.get('/api/errors', (context) => {
    const query = context.req.query();
    const filter = filterOf(query);
    const page = parsePage(query);
    const { total, items } = browseErrors(db, filter, page);
    const body: ErrorsResponse = {
      total,
      ...page,
      items,
      codes: countErrorCodes(db, filter),
      runs: listRunSummaries(db, RUN_OPTIONS),
    };
    return context.json(body);
  });

  // CSV の書き出し(絞り込みに合う全件。Excel で文字化けしないよう、BOM をつける)
  app.get('/api/errors.csv', (context) => {
    const { items } = browseErrors(db, filterOf(context.req.query()), {
      limit: null,
      offset: 0,
    });
    const lines = [
      ['コード', 'ファイル', '詳細', '実行', '日時(UTC)']
        .map(csvCell)
        .join(','),
      ...items.map((item) =>
        [
          item.code,
          item.source
            ? [
                item.source.volumeLabel,
                item.source.relPath,
                item.source.entryPath,
              ]
                .filter((part) => part !== null && part !== '')
                .join(' / ')
            : '',
          item.detail,
          `#${item.runId}`,
          item.occurredAt,
        ]
          .map(csvCell)
          .join(',')
      ),
    ];
    return new Response(`﻿${lines.join('\r\n')}\r\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="errors.csv"',
      },
    });
  });

  app.get('/api/errors/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const error = id === undefined ? undefined : getBrowsedError(db, id);
    if (!error) return context.json({ error: 'not found' }, 404);
    const body: ErrorDetailResponse = {
      error,
      attempts: error.source
        ? listRepairAttempts(db, error.source.sourceFileId)
        : [],
    };
    return context.json(body);
  });
};
