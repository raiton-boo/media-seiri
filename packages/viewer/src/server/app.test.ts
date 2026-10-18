import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRun, upsertVolume } from '@file-seiri/ledger';
import type { DashboardResponse } from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { startViewer } from './start.ts';
import { get, HASH, makeSource, NOW } from './test-support.ts';

const webDirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-viewer-web-'));
  webDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of webDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('API', () => {
  test('/api/dashboard: 概要・最近の実行・ドライブの容量・台帳の鮮度を返す', async () => {
    const source = makeSource();
    const volume = upsertVolume(source.ledger.db, {
      volumeUuid: 'v',
      label: 'Backup',
      seenAt: NOW,
    });
    startRun(source.ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const response = await get(createViewerApp(source), '/api/dashboard');
    expect(response.status).toBe(200);
    const body = (await response.json()) as DashboardResponse;
    expect(body.library.name).toBe('PhotoLib');
    expect(body.source).toBe('snapshot');
    expect(body.asOf).toBe('2026-10-18T00:00:00.000Z');
    expect(body.summary.files.total).toBe(0);
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      sourceLabel: 'Backup',
      status: 'running',
    });
    expect(body.disk).toEqual({ totalBytes: 2000, freeBytes: 500 });
    // スナップショットでは、実行中の表示は、しない(実行は、この Mac の CLI だけ)
    expect(body.running).toBeNull();
  });

  test('この Mac の作業用の台帳では、実行中の取り込みの進み具合を返す', async () => {
    const source = makeSource({ source: 'working' });
    const volume = upsertVolume(source.ledger.db, {
      volumeUuid: 'v',
      seenAt: NOW,
    });
    const runId = startRun(source.ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const body = (await (
      await get(createViewerApp(source), '/api/dashboard')
    ).json()) as DashboardResponse;
    expect(body.running).toMatchObject({ runId, total: 0, done: 0 });
  });

  test('ドライブが接続されていなければ、容量は null', async () => {
    const source = makeSource({ disk: () => null });
    const body = (await (
      await get(createViewerApp(source), '/api/dashboard')
    ).json()) as DashboardResponse;
    expect(body.disk).toBeNull();
  });

  test('/api/info: ライブラリと台帳の鮮度', async () => {
    const response = await get(createViewerApp(makeSource()), '/api/info');
    expect(await response.json()).toEqual({
      library: {
        id: 'lib-1',
        name: 'PhotoLib',
        fsType: 'exfat',
        mediaKind: 'hdd',
      },
      source: 'snapshot',
      asOf: '2026-10-18T00:00:00.000Z',
    });
  });

  test('知らない API は 404', async () => {
    const response = await get(createViewerApp(makeSource()), '/api/nothing');
    expect(response.status).toBe(404);
  });
});

describe('サムネイル', () => {
  test('ハッシュの名前のサムネイルを、JPEG として返す', async () => {
    const response = await get(
      createViewerApp(makeSource()),
      `/api/thumbs/${HASH.slice(0, 2)}/${HASH}.jpg`
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(await response.text()).toBe('jpeg-bytes');
  });

  test('ないものは 404。決まった形でない名前は、置き場の外を指していても、404', async () => {
    const app = createViewerApp(makeSource());
    expect(
      (await get(app, `/api/thumbs/00/${'0'.repeat(64)}.jpg`)).status
    ).toBe(404);
    expect((await get(app, '/api/thumbs/ab/..%2F..%2Fsecret.jpg')).status).toBe(
      404
    );
    expect((await get(app, `/api/thumbs/..%2Ffoo/${HASH}.jpg`)).status).toBe(
      404
    );
    expect((await get(app, `/api/thumbs/ab/${HASH}.png`)).status).toBe(404);
  });
});

describe('本機だけ・閲覧専用', () => {
  test('本機以外の Host は、403', async () => {
    const app = createViewerApp(makeSource());
    expect(
      (await get(app, '/api/dashboard', { host: 'evil.example' })).status
    ).toBe(403);
    expect(
      (await get(app, '/api/dashboard', { host: 'localhost:3939' })).status
    ).toBe(200);
    expect(
      (await get(app, '/api/dashboard', { host: '[::1]:3939' })).status
    ).toBe(200);
  });

  test('GET・HEAD 以外は、405(台帳を書き換える手段を持たない)', async () => {
    const app = createViewerApp(makeSource());
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect((await get(app, '/api/dashboard', { method })).status).toBe(405);
    }
  });
});

describe('startViewer(画面のファイルの配信)', () => {
  test('API と、静的ファイル(拡張子なしの名前・フォルダ)を配信し、置き場の外は読ませない', async () => {
    const webDir = tempDir();
    writeFileSync(join(webDir, 'index.html'), '<h1>top</h1>');
    writeFileSync(join(webDir, 'errors.html'), '<h1>errors</h1>');
    writeFileSync(join(webDir, '..secret'), 'x');
    const running = startViewer({ source: makeSource(), webDir, port: 0 });
    try {
      const text = async (
        path: string,
        init?: RequestInit
      ): Promise<[number, string]> => {
        const response = await fetch(
          `${running.url.slice(0, -1)}${path}`,
          init
        );
        return [response.status, await response.text()];
      };
      expect(await text('/')).toEqual([200, '<h1>top</h1>']);
      expect(await text('/errors')).toEqual([200, '<h1>errors</h1>']);
      expect((await text('/nothing'))[0]).toBe(404);
      expect((await text('/..%2F..%2Fetc%2Fpasswd'))[0]).toBe(404);
      expect((await text('/api/info'))[0]).toBe(200);
      expect((await text('/', { method: 'POST' }))[0]).toBe(405);
    } finally {
      running.stop();
    }
  });
});
