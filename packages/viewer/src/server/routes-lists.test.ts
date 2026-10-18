import { describe, expect, test } from 'bun:test';
import {
  getOrCreateContent,
  insertDuplicateLink,
  insertFileGroup,
  insertLibraryFile,
  insertSourceFile,
  setSourceFileContent,
  setSourceFileState,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import type {
  DupeDetailResponse,
  DupesResponse,
  FallbackResponse,
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
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  const addLibraryFile = (
    relPath: string,
    hash: string,
    dateSource: string,
    takenAt: string | null
  ) => {
    const { content } = getOrCreateContent(db, {
      hash: hash.repeat(64).slice(0, 64),
      sizeBytes: 10,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, date_reason)
       VALUES (?, ?, ?, ?, 'テスト')`
    ).run(content.contentId, takenAt, takenAt ? 'date' : 'none', dateSource);
    const libraryFileId = insertLibraryFile(db, {
      contentId: content.contentId,
      groupId: insertFileGroup(db, { stem: relPath, bucket: 'full' }),
      runId,
      relPath,
      bucket: 'full',
      createdAt: NOW,
    });
    const sourceId = insertSourceFile(db, {
      runId,
      volumeId: volume.volumeId,
      relPath: `src/${relPath}`,
      sizeBytes: 10,
      mtimeMs: 1,
      kind: 'photo',
      ext: 'jpg',
    });
    setSourceFileContent(db, sourceId, content.contentId);
    setSourceFileState(db, sourceId, 'done');
    return libraryFileId;
  };
  const exif = addLibraryFile('2024/a.jpg', 'a', 'exif', '2024-03-05');
  addLibraryFile('2015/b.jpg', 'b', 'filename', '2015-07-04');
  const skipped = insertSourceFile(db, {
    runId,
    volumeId: volume.volumeId,
    relPath: 'Copy/a.jpg',
    sizeBytes: 10,
    mtimeMs: 1,
    kind: 'photo',
    ext: 'jpg',
  });
  insertDuplicateLink(db, {
    skippedSourceFileId: skipped,
    adoptedLibraryFileId: exif,
    createdAt: NOW,
  });
  return { source, exif, volume, runId };
};

describe('/api/fallback', () => {
  test('日付フォールバックの一覧・取得元ごとの件数・ドライブの選択肢を返す', async () => {
    const { source } = seed();
    const body = (await (
      await get(createViewerApp(source), '/api/fallback')
    ).json()) as FallbackResponse;
    expect(body).toMatchObject({
      total: 1,
      limit: 50,
      offset: 0,
      counts: { json: 0, filename: 1, none: 0 },
    });
    expect(body.items[0]).toMatchObject({
      libraryRelPath: '2015/b.jpg',
      dateSource: 'filename',
    });
    expect(body.volumes).toEqual([
      { volumeId: expect.any(Number), label: 'Backup' },
    ]);
  });

  test('絞り込み(source・precision・run)。不正な値は、無視する', async () => {
    const { source, runId } = seed();
    const app = createViewerApp(source);
    const total = async (path: string) =>
      ((await (await get(app, path)).json()) as FallbackResponse).total;
    expect(await total('/api/fallback?source=json')).toBe(0);
    expect(await total('/api/fallback?source=filename')).toBe(1);
    expect(await total('/api/fallback?precision=year')).toBe(0);
    expect(await total(`/api/fallback?run=${runId}`)).toBe(1);
    expect(
      await total('/api/fallback?source=bogus&precision=bogus&run=x')
    ).toBe(1);
  });
});

describe('/api/dupes', () => {
  test('重複のグループと、スキップした数・選択肢を返す。検索できる', async () => {
    const { source, exif } = seed();
    const app = createViewerApp(source);
    const body = (await (await get(app, '/api/dupes')).json()) as DupesResponse;
    expect(body).toMatchObject({ total: 1, totalSkipped: 1 });
    expect(body.items[0]).toMatchObject({
      adoptedLibraryFileId: exif,
      skippedCount: 1,
    });
    expect(body.volumes).toHaveLength(1);
    expect(body.runs).toHaveLength(1);
    const searched = (await (
      await get(app, '/api/dupes?q=nothing')
    ).json()) as DupesResponse;
    expect(searched.total).toBe(0);
  });

  test('/api/dupes/:id: 採用側とスキップ側。ないものは 404', async () => {
    const { source, exif } = seed();
    const app = createViewerApp(source);
    const detail = (await (
      await get(app, `/api/dupes/${exif}`)
    ).json()) as DupeDetailResponse;
    expect(detail.adopted.relPath).toBe('2024/a.jpg');
    expect(detail.skipped.map((s) => s.relPath)).toEqual(['Copy/a.jpg']);
    expect((await get(app, '/api/dupes/999')).status).toBe(404);
    expect((await get(app, '/api/dupes/abc')).status).toBe(404);
  });
});
