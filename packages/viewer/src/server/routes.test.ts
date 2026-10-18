import { describe, expect, test } from 'bun:test';
import {
  finishRun,
  insertSourceFile,
  recordError,
  recordRepairAttempt,
  setSourceFileState,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import type {
  ErrorDetailResponse,
  ErrorsResponse,
  RunDetailResponse,
  RunsResponse,
} from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { get, makeSource, NOW } from './test-support.ts';

const seed = () => {
  const source = makeSource();
  const { db } = source.ledger;
  const volume = upsertVolume(db, {
    volumeUuid: 'v',
    label: 'Backup',
    seenAt: NOW,
  });
  const real = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  const dry = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: true,
    startedAt: NOW,
  });
  const fileId = insertSourceFile(db, {
    runId: real,
    volumeId: volume.volumeId,
    relPath: 'DCIM/a, "b".jpg',
    sizeBytes: 10,
    mtimeMs: 1,
    kind: 'photo',
    ext: 'jpg',
  });
  setSourceFileState(db, fileId, 'error');
  const errorId = recordError(db, {
    runId: real,
    sourceFileId: fileId,
    code: 'HASH_MISMATCH',
    detail: '改行\nを含む',
    occurredAt: NOW,
  });
  recordError(db, { runId: dry, code: 'EMPTY_FILE', occurredAt: NOW });
  recordRepairAttempt(db, {
    sourceFileId: fileId,
    method: 'video_remux',
    isSuccess: false,
    attemptedAt: NOW,
  });
  finishRun(db, real, { status: 'interrupted', finishedAt: NOW });
  return { source, real, dry, errorId };
};

describe('/api/errors', () => {
  test('通常の実行のエラーを、コード別の件数・実行の選択肢つきで返す。実行を指定すれば、dry-run も', async () => {
    const { source, real, dry } = seed();
    const app = createViewerApp(source);
    const all = (await (
      await get(app, '/api/errors')
    ).json()) as ErrorsResponse;
    expect(all).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(all.items[0]?.code).toBe('HASH_MISMATCH');
    expect(all.codes).toEqual([{ code: 'HASH_MISMATCH', count: 1 }]);
    expect(all.runs.map((run) => run.runId)).toEqual([dry, real]);
    const dryErrors = (await (
      await get(app, `/api/errors?run=${dry}`)
    ).json()) as ErrorsResponse;
    expect(dryErrors.items.map((item) => item.code)).toEqual(['EMPTY_FILE']);
    const none = (await (
      await get(app, '/api/errors?code=READ_FAILED')
    ).json()) as ErrorsResponse;
    expect(none.total).toBe(0);
  });

  test('不正なクエリ(limit・offset・run)は、既定値として扱う', async () => {
    const app = createViewerApp(seed().source);
    const body = (await (
      await get(app, '/api/errors?limit=abc&offset=-1&run=x')
    ).json()) as ErrorsResponse;
    expect(body).toMatchObject({ total: 1, limit: 50, offset: 0 });
    const capped = (await (
      await get(app, '/api/errors?limit=99999')
    ).json()) as ErrorsResponse;
    expect(capped.limit).toBe(500);
  });

  test('/api/errors/:id: 詳細と、試した修復の手順。ないものは 404', async () => {
    const { source, errorId } = seed();
    const app = createViewerApp(source);
    const detail = (await (
      await get(app, `/api/errors/${errorId}`)
    ).json()) as ErrorDetailResponse;
    expect(detail.error.source?.relPath).toBe('DCIM/a, "b".jpg');
    expect(detail.attempts).toMatchObject([
      { method: 'video_remux', isSuccess: false },
    ]);
    expect((await get(app, '/api/errors/999')).status).toBe(404);
    expect((await get(app, '/api/errors/abc')).status).toBe(404);
  });

  test('/api/errors.csv: BOM つき。カンマ・引用符・改行は、引用符で囲む', async () => {
    const app = createViewerApp(seed().source);
    const response = await get(app, '/api/errors.csv');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('errors.csv');
    const text = await response.text();
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('コード,ファイル,詳細,実行,日時(UTC)');
    expect(text).toContain('"Backup / DCIM/a, ""b"".jpg"');
    expect(text).toContain('"改行\nを含む"');
  });
});

describe('/api/runs', () => {
  test('絞り込み(filter)・ページ送りで、実行を返す。不正な filter は、すべて', async () => {
    const { source, real, dry } = seed();
    const app = createViewerApp(source);
    const ids = async (path: string) =>
      ((await (await get(app, path)).json()) as RunsResponse).items.map(
        (run) => run.runId
      );
    expect(await ids('/api/runs')).toEqual([dry, real]);
    expect(await ids('/api/runs?filter=dry-run')).toEqual([dry]);
    expect(await ids('/api/runs?filter=normal')).toEqual([real]);
    expect(await ids('/api/runs?filter=interrupted')).toEqual([real]);
    expect(await ids('/api/runs?filter=bogus')).toEqual([dry, real]);
    const page = (await (
      await get(app, '/api/runs?limit=1&offset=1')
    ).json()) as RunsResponse;
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 });
  });

  test('/api/runs/:id: 詳細とライブラリ。ないものは 404', async () => {
    const { source, real } = seed();
    const app = createViewerApp(source);
    const body = (await (
      await get(app, `/api/runs/${real}`)
    ).json()) as RunDetailResponse;
    expect(body.run).toMatchObject({ runId: real, detected: 1, errors: 1 });
    expect(body.library.name).toBe('PhotoLib');
    expect((await get(app, '/api/runs/999')).status).toBe(404);
  });
});
