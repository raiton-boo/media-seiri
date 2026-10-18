import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  getOrCreateContent,
  insertFileGroup,
  insertLibraryFile,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import type {
  PhotoDetailResponse,
  PhotoStripResponse,
  SlideshowResponse,
} from '../api-types.ts';
import { createViewerApp } from './app.ts';
import { get, makeSource, NOW } from './test-support.ts';

/** 台帳に写真を入れ、原本(`bytes` があれば)を、ライブラリの根に置く */
const seed = (files: { rel: string; takenAt: string; bytes?: string }[]) => {
  const source = makeSource();
  const { db } = source.ledger;
  const volume = upsertVolume(db, { volumeUuid: 'v', seenAt: NOW });
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  const ids = new Map<string, number>();
  files.forEach((file, index) => {
    const { content } = getOrCreateContent(db, {
      hash: String(index + 1).padStart(64, 'd'),
      sizeBytes: file.bytes?.length ?? 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, width, height)
       VALUES (?, ?, 'full', 'exif', 1200, 800)`
    ).run(content.contentId, file.takenAt);
    ids.set(
      file.rel,
      insertLibraryFile(db, {
        contentId: content.contentId,
        groupId: insertFileGroup(db, { stem: file.rel, bucket: 'full' }),
        runId,
        relPath: file.rel,
        bucket: 'full',
        createdAt: NOW,
      })
    );
    if (file.bytes !== undefined) {
      const path = join(source.libraryRoot, file.rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.bytes);
    }
  });
  return { source, ids };
};

describe('GET /api/album/photo/:id', () => {
  test('情報と、原本の表示の可否(表示できる形・接続中か)', async () => {
    const { source, ids } = seed([
      { rel: 'a.jpg', takenAt: '2024-03-05T10:00:00', bytes: 'x' },
      { rel: 'b.heic', takenAt: '2024-03-06T10:00:00', bytes: 'x' },
      { rel: 'c.mp4', takenAt: '2024-03-07T10:00:00' },
    ]);
    const app = createViewerApp(source);
    const detail = async (rel: string) =>
      (await (
        await get(app, `/api/album/photo/${ids.get(rel)}`)
      ).json()) as PhotoDetailResponse;
    expect(await detail('a.jpg')).toMatchObject({
      photo: { relPath: 'a.jpg', kind: 'photo', width: 1200 },
      original: { viewKind: 'image', available: true },
    });
    expect((await detail('b.heic')).original).toEqual({
      viewKind: null,
      available: true,
    });
    // 動画だが、原本のファイルがない(ドライブが接続されていない)
    expect((await detail('c.mp4')).original).toEqual({
      viewKind: 'video',
      available: false,
    });
    expect((await get(app, '/api/album/photo/99999')).status).toBe(404);
    expect((await get(app, '/api/album/photo/x')).status).toBe(404);
  });
});

describe('GET /api/album/photo/:id/strip', () => {
  test('前後(表示の順)。条件・できごとの範囲が効く。位置なしは、条件に合わない写真', async () => {
    const { source, ids } = seed([
      { rel: 'a.jpg', takenAt: '2024-03-05T10:00:00' },
      { rel: 'b.jpg', takenAt: '2024-03-06T10:00:00' },
      { rel: 'c.mp4', takenAt: '2024-03-07T10:00:00' },
    ]);
    const app = createViewerApp(source);
    const strip = async (query: string) =>
      (await (
        await get(app, `/api/album/photo/${ids.get('b.jpg')}/strip${query}`)
      ).json()) as PhotoStripResponse;
    const all = await strip('?radius=1');
    expect(all).toMatchObject({ total: 3, position: 2, order: 'new' });
    expect(all.photos.map((p) => p.relPath)).toEqual([
      'c.mp4',
      'b.jpg',
      'a.jpg',
    ]);
    expect(
      (await strip('?order=old&radius=1')).photos.map((p) => p.relPath)
    ).toEqual(['a.jpg', 'b.jpg', 'c.mp4']);
    expect(await strip('?kind=video')).toMatchObject({
      total: 1,
      position: null,
      photos: [],
    });
    expect((await get(app, '/api/album/photo/x/strip')).status).toBe(400);
  });
});

describe('GET /api/files/:id(原本)', () => {
  const setup = () =>
    seed([
      {
        rel: '2024/a.jpg',
        takenAt: '2024-03-05T10:00:00',
        bytes: '0123456789',
      },
      { rel: 'b.heic', takenAt: '2024-03-06T10:00:00', bytes: 'x' },
      { rel: 'gone.jpg', takenAt: '2024-03-07T10:00:00' },
      { rel: '../outside.jpg', takenAt: '2024-03-08T10:00:00' },
    ]);

  test('表示できる形は、そのまま返す(Content-Type・範囲指定・HEAD)', async () => {
    const { source, ids } = setup();
    const app = createViewerApp(source);
    const url = `/api/files/${ids.get('2024/a.jpg')}`;
    const whole = await get(app, url);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-type')).toBe('image/jpeg');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(await whole.text()).toBe('0123456789');

    const part = await get(app, url, { headers: { range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    const tail = await get(app, url, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    expect(
      (await get(app, url, { headers: { range: 'bytes=50-60' } })).status
    ).toBe(416);
    expect((await get(app, url, { method: 'HEAD' })).status).toBe(200);
  });

  test('表示できない形は 415、原本がなければ 404、台帳にないものも 404', async () => {
    const { source, ids } = setup();
    const app = createViewerApp(source);
    expect((await get(app, `/api/files/${ids.get('b.heic')}`)).status).toBe(
      415
    );
    expect((await get(app, `/api/files/${ids.get('gone.jpg')}`)).status).toBe(
      404
    );
    expect((await get(app, '/api/files/99999')).status).toBe(404);
  });

  test('ライブラリの根の外は、台帳の値が壊れていても、読ませない', async () => {
    const { source, ids } = setup();
    // 根の外に、本物のファイルを置く
    writeFileSync(join(source.libraryRoot, '..', 'outside.jpg'), 'secret');
    const app = createViewerApp(source);
    expect(
      (await get(app, `/api/files/${ids.get('../outside.jpg')}`)).status
    ).toBe(404);
  });

  test('書き込みの方法は、受け付けない', async () => {
    const { source, ids } = setup();
    const app = createViewerApp(source);
    expect(
      (
        await get(app, `/api/files/${ids.get('2024/a.jpg')}`, {
          method: 'DELETE',
        })
      ).status
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/album/slideshow', () => {
  test('条件に合う写真を、表示の順に返す(種別の条件も効く)', async () => {
    const { source } = seed([
      { rel: 'a.jpg', takenAt: '2024-03-05T10:00:00' },
      { rel: 'b.jpg', takenAt: '2024-03-06T10:00:00' },
      { rel: 'c.mp4', takenAt: '2024-03-07T10:00:00' },
    ]);
    const app = createViewerApp(source);
    const slides = async (query: string) =>
      (await (
        await get(app, `/api/album/slideshow${query}`)
      ).json()) as SlideshowResponse;
    expect((await slides('')).photos.map((p) => p.relPath)).toEqual([
      'c.mp4',
      'b.jpg',
      'a.jpg',
    ]);
    expect((await slides('?order=old')).photos.map((p) => p.relPath)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.mp4',
    ]);
    expect(await slides('?kind=video')).toMatchObject({
      total: 1,
      photos: [{ relPath: 'c.mp4' }],
    });
  });
});
