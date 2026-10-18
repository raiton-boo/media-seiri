import { describe, expect, test } from 'bun:test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
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
  SameDayResponse,
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
      from: 'library',
      sourceLabel: null,
    });
    // 動画だが、原本のファイルがない(ドライブが接続されていない)
    expect((await detail('c.mp4')).original).toEqual({
      viewKind: 'video',
      available: false,
      from: null,
      sourceLabel: null,
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

describe('ソース側のコピーから原本を探す', () => {
  const MTIME_MS = 1_700_000_000_000;

  /** ライブラリには原本がなく、ソース側(接続中のドライブ)に、同じ内容のファイルがある */
  const seedWithSource = (copyBytes: string) => {
    const { source, ids } = seed([
      { rel: 'lost.jpg', takenAt: '2024-03-05T10:00:00' },
    ]);
    const { db } = source.ledger;
    const volume = upsertVolume(db, {
      volumeUuid: 'src-1',
      label: 'SDCARD',
      seenAt: NOW,
    });
    const run = startRun(db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const contentId = (
      db.query('SELECT content_id AS id FROM library_files').get() as {
        id: number;
      }
    ).id;
    db.query(
      `INSERT INTO source_files (run_id, volume_id, rel_path, size_bytes, mtime_ms, kind, ext, content_id, state)
       VALUES (?, ?, 'DCIM/lost.jpg', 1, ?, 'photo', 'jpg', ?, 'done')`
    ).run(run, volume.volumeId, MTIME_MS, contentId);
    // ソース側のドライブ(の代わりの、フォルダ)
    const mount = join(dirname(source.libraryRoot), 'sdcard');
    mkdirSync(join(mount, 'DCIM'), { recursive: true });
    const file = join(mount, 'DCIM', 'lost.jpg');
    writeFileSync(file, copyBytes);
    utimesSync(file, MTIME_MS / 1000, MTIME_MS / 1000);
    source.mountedRoots = () => new Map([['src-1', mount]]);
    return { source, id: ids.get('lost.jpg') as number };
  };

  test('サイズと更新日が一致するコピーを、ソース側として表示する', async () => {
    const { source, id } = seedWithSource('x');
    const app = createViewerApp(source);
    const detail = (await (
      await get(app, `/api/album/photo/${id}`)
    ).json()) as PhotoDetailResponse;
    expect(detail.original).toEqual({
      viewKind: 'image',
      available: true,
      from: 'source',
      sourceLabel: 'SDCARD',
    });
    const file = await get(app, `/api/files/${id}`);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe('x');
  });

  test('サイズが違うコピーは、使わない(同じファイルとは限らない)', async () => {
    const { source, id } = seedWithSource('xx');
    const app = createViewerApp(source);
    const detail = (await (
      await get(app, `/api/album/photo/${id}`)
    ).json()) as PhotoDetailResponse;
    expect(detail.original).toMatchObject({ available: false, from: null });
    expect((await get(app, `/api/files/${id}`)).status).toBe(404);
  });

  test('ドライブが接続されていなければ、使わない', async () => {
    const { source, id } = seedWithSource('x');
    source.mountedRoots = () => new Map();
    const detail = (await (
      await get(createViewerApp(source), `/api/album/photo/${id}`)
    ).json()) as PhotoDetailResponse;
    expect(detail.original.available).toBe(false);
  });
});

describe('GET /api/album/photo/:id/same-day', () => {
  test('同じ月日の、ほかの年を、新しい年から。日まで分からない写真は、空', async () => {
    const { source, ids } = seed([
      { rel: 'a2023.jpg', takenAt: '2023-03-05T10:00:00' },
      { rel: 'b2024.jpg', takenAt: '2024-03-05T10:00:00' },
      { rel: 'c2025.jpg', takenAt: '2025-03-05T09:00:00' },
      { rel: 'd2025.jpg', takenAt: '2025-03-05T11:00:00' },
      { rel: 'e.jpg', takenAt: '2024-03-06T10:00:00' },
      { rel: 'f.jpg', takenAt: '2024-03' },
    ]);
    const app = createViewerApp(source);
    const sameDay = async (rel: string) =>
      (await (
        await get(app, `/api/album/photo/${ids.get(rel)}/same-day`)
      ).json()) as SameDayResponse;
    const result = await sameDay('b2024.jpg');
    expect(result.monthDay).toBe('03-05');
    expect(result.years.map((item) => [item.year, item.count])).toEqual([
      [2025, 2],
      [2023, 1],
    ]);
    // 代表は、その年の、いちばん早い 1 枚
    expect(result.years[0]?.libraryFileId).toBe(ids.get('c2025.jpg'));
    expect(await sameDay('f.jpg')).toEqual({ monthDay: null, years: [] });
  });
});

describe('期間の絞り込み(from・to)', () => {
  test('日まで分かる写真だけが、期間(両端を含む)に入る', async () => {
    const { source } = seed([
      { rel: 'a.jpg', takenAt: '2024-03-04T10:00:00' },
      { rel: 'b.jpg', takenAt: '2024-03-05T10:00:00' },
      { rel: 'c.jpg', takenAt: '2024-03-07T10:00:00' },
      { rel: 'd.jpg', takenAt: '2024-03-08T10:00:00' },
      { rel: 'e.jpg', takenAt: '2024-03' },
    ]);
    const app = createViewerApp(source);
    const count = async (query: string) =>
      (
        (await (
          await get(app, `/api/album/search/photos?${query}`)
        ).json()) as { total: number }
      ).total;
    expect(await count('from=2024-03-05&to=2024-03-07')).toBe(2);
    expect(await count('from=2024-03-08')).toBe(1);
    expect(await count('to=2024-03-04')).toBe(1);
    // 読めない日付は、無視(絞らない)
    expect(await count('from=2024-13-40')).toBe(5);
  });
});
