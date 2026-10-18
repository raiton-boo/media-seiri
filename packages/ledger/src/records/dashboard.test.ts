import { describe, expect, test } from 'bun:test';
import { getOrCreateContent } from './contents.ts';
import {
  getDashboardSummary,
  getRunningProgress,
  listRunSummaries,
} from './dashboard.ts';
import { insertDuplicateLink } from './duplicate-links.ts';
import { recordError } from './error-records.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, seedSourceFile, T0 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';
import { finishRun, startRun } from './runs.ts';
import { setSourceFileContent, setSourceFileState } from './source-files.ts';
import { upsertVolume } from './volumes.ts';

type Db = ReturnType<typeof openDb>;

let hashCounter = 0;
/** 内容・メタデータ・ライブラリのファイルを 1 つ作る */
const addLibraryFile = (
  db: Db,
  seed: { runId: number },
  options: {
    relPath: string;
    sizeBytes: number;
    takenAt?: string | null;
    precision?: string;
    source?: string;
    gps?: [number, number];
    bucket?: 'full' | 'unknown_none';
  }
): number => {
  hashCounter += 1;
  const { content } = getOrCreateContent(db, {
    hash: String(hashCounter).padStart(64, 'a'),
    sizeBytes: options.sizeBytes,
  });
  db.query(
    `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, gps_lat, gps_lon)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    content.contentId,
    options.takenAt ?? null,
    options.precision ?? 'full',
    options.source ?? 'exif',
    options.gps?.[0] ?? null,
    options.gps?.[1] ?? null
  );
  insertLibraryFile(db, {
    contentId: content.contentId,
    groupId: insertFileGroup(db, {
      stem: options.relPath,
      bucket: options.bucket ?? 'full',
    }),
    runId: seed.runId,
    relPath: options.relPath,
    bucket: options.bucket ?? 'full',
    createdAt: T0,
  });
  return content.contentId;
};

describe('getDashboardSummary', () => {
  test('空の台帳は、すべて 0 で、期間はなし', () => {
    expect(getDashboardSummary(openDb())).toEqual({
      files: { total: 0, photos: 0, videos: 0, raws: 0, sizeBytes: 0 },
      period: null,
      gps: { with: 0, without: 0 },
      lastIngestAt: null,
      attention: { errors: 0, dateFallback: 0, dateUnknown: 0, duplicates: 0 },
    });
  });

  test('種類別の数・総サイズ・期間・GPS・要チェックを数える。サイドカーは、数に入れず、サイズには入れる', () => {
    const db = openDb();
    const seed = seedRun(db);
    addLibraryFile(db, seed, {
      relPath: '2013/12/a.jpg',
      sizeBytes: 1000,
      takenAt: '2013-12-05T10:00:00',
      gps: [35, 139],
    });
    addLibraryFile(db, seed, {
      relPath: '2024/08/b.mp4',
      sizeBytes: 5000,
      takenAt: '2024-08',
      precision: 'month',
      source: 'filename',
    });
    addLibraryFile(db, seed, {
      relPath: '2020/01/c.cr3',
      sizeBytes: 3000,
      takenAt: '2020-01-02',
      precision: 'date',
    });
    addLibraryFile(db, seed, {
      relPath: '2020/01/c.xmp',
      sizeBytes: 10,
      takenAt: '2020-01-02',
      precision: 'date',
    });
    addLibraryFile(db, seed, {
      relPath: '_unknown/日付なし/d.jpg',
      sizeBytes: 200,
      precision: 'none',
      source: 'none',
      bucket: 'unknown_none',
    });

    const summary = getDashboardSummary(db);
    expect(summary.files).toEqual({
      total: 4,
      photos: 2,
      videos: 1,
      raws: 1,
      sizeBytes: 9210,
    });
    expect(summary.period).toEqual({
      from: '2013-12-05T10:00:00',
      to: '2024-08',
    });
    // GPS: 付き 1(この例では、xmp にも、メタデータの行を持たせている)
    expect(summary.gps.with).toBe(1);
    expect(summary.gps.without).toBe(4);
    expect(summary.attention.dateFallback).toBe(1);
    expect(summary.attention.dateUnknown).toBe(1);
  });

  test('dry-run のエラー・重複は、数えない', () => {
    const db = openDb();
    const real = seedRun(db);
    const dry = seedRun(db, { isDryRun: true, uuid: 'vol-2' });
    recordError(db, { runId: real.runId, code: 'READ_FAILED', occurredAt: T0 });
    recordError(db, { runId: dry.runId, code: 'READ_FAILED', occurredAt: T0 });
    const adopted = addLibraryFile(db, real, {
      relPath: '2024/a.jpg',
      sizeBytes: 1,
      takenAt: '2024',
      precision: 'year',
    });
    const libraryFileId = (
      db
        .query<{ id: number }, [number]>(
          'SELECT library_file_id AS id FROM library_files WHERE content_id = ?'
        )
        .get(adopted) as { id: number }
    ).id;
    for (const seed of [real, dry]) {
      const sourceFileId = seedSourceFile(db, seed);
      insertDuplicateLink(db, {
        skippedSourceFileId: sourceFileId,
        adoptedLibraryFileId: libraryFileId,
        createdAt: T0,
      });
    }
    const { attention } = getDashboardSummary(db);
    expect(attention.errors).toBe(1);
    expect(attention.duplicates).toBe(1);
  });
});

describe('listRunSummaries', () => {
  test('新しい順に、実行ごとの採用・重複・フォールバック・エラーを数える', () => {
    const db = openDb();
    upsertVolume(db, { volumeUuid: 'vol-1', label: 'Backup', seenAt: T0 });
    const seed = seedRun(db);
    const fileA = seedSourceFile(db, seed, { relPath: 'a.jpg' });
    const fileB = seedSourceFile(db, seed, { relPath: 'b.jpg' });
    const fileC = seedSourceFile(db, seed, { relPath: 'c.jpg' });
    const contentA = addLibraryFile(db, seed, {
      relPath: '2024/a.jpg',
      sizeBytes: 1,
      takenAt: '2024-03',
      precision: 'month',
      source: 'json',
    });
    setSourceFileContent(db, fileA, contentA);
    setSourceFileState(db, fileA, 'done');
    setSourceFileState(db, fileB, 'duplicate');
    setSourceFileState(db, fileC, 'error');
    recordError(db, { runId: seed.runId, code: 'READ_FAILED', occurredAt: T0 });
    finishRun(db, seed.runId, { status: 'completed', finishedAt: T0 });
    const second = startRun(db, {
      kind: 'thumbs',
      sourceVolumeId: seed.volumeId,
      isDryRun: false,
      startedAt: T0,
    });

    const runs = listRunSummaries(db, 10);
    expect(runs.map((run) => run.runId)).toEqual([second, seed.runId]);
    expect(runs[0]).toMatchObject({
      kind: 'thumbs',
      status: 'running',
      sourceLabel: 'Backup',
      adopted: 0,
    });
    expect(runs[1]).toMatchObject({
      kind: 'ingest',
      isDryRun: false,
      status: 'completed',
      adopted: 1,
      duplicates: 1,
      dateFallback: 1,
      errors: 1,
    });
    expect(listRunSummaries(db, 1)).toHaveLength(1);
  });
});

describe('getRunningProgress', () => {
  test('実行中の取り込みがなければ、undefined(検査・サムネイル・dry-run は対象外)', () => {
    const db = openDb();
    expect(getRunningProgress(db)).toBeUndefined();
    const seed = seedRun(db, { isDryRun: true });
    expect(getRunningProgress(db)).toBeUndefined();
    startRun(db, {
      kind: 'verify',
      sourceVolumeId: seed.volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    expect(getRunningProgress(db)).toBeUndefined();
  });

  test('終えた数・全体・サイズを返す(無視したものは、全体に入れない)', () => {
    const db = openDb();
    const seed = seedRun(db);
    const done = seedSourceFile(db, seed, { relPath: 'a.jpg', sizeBytes: 100 });
    const planned = seedSourceFile(db, seed, {
      relPath: 'b.jpg',
      sizeBytes: 300,
    });
    const duplicate = seedSourceFile(db, seed, {
      relPath: 'c.jpg',
      sizeBytes: 50,
    });
    const ignored = seedSourceFile(db, seed, {
      relPath: 'd.jpg',
      sizeBytes: 9,
    });
    setSourceFileState(db, done, 'done');
    setSourceFileState(db, planned, 'planned');
    setSourceFileState(db, duplicate, 'duplicate');
    setSourceFileState(db, ignored, 'ignored');
    expect(getRunningProgress(db)).toMatchObject({
      runId: seed.runId,
      total: 3,
      done: 2,
      adopted: 2,
      duplicates: 1,
      plannedBytes: 400,
      copiedBytes: 100,
      errors: 0,
    });
  });
});
