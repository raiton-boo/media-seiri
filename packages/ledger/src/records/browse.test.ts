import { describe, expect, test } from 'bun:test';
import { getOrCreateContent } from './contents.ts';
import {
  browseErrors,
  countErrorCodes,
  getBrowsedError,
} from './error-browse.ts';
import { recordError } from './error-records.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, seedSourceFile, T0, T1 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';
import { browseRuns, getRunDetail } from './run-browse.ts';
import { finishRun, recordRunCapacity } from './runs.ts';
import { setSourceFileContent, setSourceFileState } from './source-files.ts';
import { upsertVolume } from './volumes.ts';

describe('browseErrors', () => {
  const seed = () => {
    const db = openDb();
    upsertVolume(db, { volumeUuid: 'vol-1', label: 'Backup', seenAt: T0 });
    const real = seedRun(db);
    const dry = seedRun(db, { isDryRun: true, uuid: 'vol-2' });
    const file = seedSourceFile(db, real, { relPath: 'DCIM/a.jpg' });
    const zipped = seedSourceFile(db, real, {
      relPath: 'DCIM/b.zip',
      kind: 'photo',
    });
    return { db, real, dry, file, zipped };
  };

  test('指定がなければ、通常の実行のエラーだけを、新しい順に返す。ファイルの情報を添える', () => {
    const { db, real, dry, file } = seed();
    recordError(db, {
      runId: real.runId,
      sourceFileId: file,
      code: 'HASH_MISMATCH',
      detail: 'ハッシュが違う',
      occurredAt: T0,
    });
    recordError(db, { runId: real.runId, code: 'READ_FAILED', occurredAt: T1 });
    recordError(db, { runId: dry.runId, code: 'EMPTY_FILE', occurredAt: T1 });
    const { total, items } = browseErrors(db, {}, { limit: 50, offset: 0 });
    expect(total).toBe(2);
    expect(items.map((item) => item.code)).toEqual([
      'READ_FAILED',
      'HASH_MISMATCH',
    ]);
    expect(items[0]?.source).toBeNull();
    expect(items[1]?.source).toMatchObject({
      volumeLabel: 'Backup',
      relPath: 'DCIM/a.jpg',
      entryPath: null,
      thumbRelPath: null,
    });
  });

  test('実行を指定すると、その実行のエラー(dry-run でも)。コードは、完全一致と、前方一致(*)', () => {
    const { db, real, dry } = seed();
    for (const code of [
      'ZIP_ENCRYPTED',
      'ZIP_UNSAFE_PATH',
      'READ_FAILED',
    ] as const) {
      recordError(db, { runId: real.runId, code, occurredAt: T0 });
    }
    recordError(db, { runId: dry.runId, code: 'EMPTY_FILE', occurredAt: T0 });
    expect(
      browseErrors(db, { runId: dry.runId }, { limit: 50, offset: 0 }).total
    ).toBe(1);
    expect(
      browseErrors(db, { code: 'ZIP_*' }, { limit: 50, offset: 0 }).total
    ).toBe(2);
    expect(
      browseErrors(db, { code: 'READ_FAILED' }, { limit: 50, offset: 0 }).total
    ).toBe(1);
    // `_` は、前方一致の中でも、文字どおりに扱う
    expect(
      browseErrors(db, { code: 'ZIP*' }, { limit: 50, offset: 0 }).total
    ).toBe(2);
    expect(
      browseErrors(db, { code: 'Z_P_*' }, { limit: 50, offset: 0 }).total
    ).toBe(0);
  });

  test('ページ送り(limit・offset)と、全件(limit なし)', () => {
    const { db, real } = seed();
    for (let index = 0; index < 5; index += 1) {
      recordError(db, {
        runId: real.runId,
        code: 'READ_FAILED',
        occurredAt: new Date(T0.getTime() + index * 1000),
      });
    }
    const page = browseErrors(db, {}, { limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(browseErrors(db, {}, { limit: null, offset: 0 }).items).toHaveLength(
      5
    );
  });

  test('コード別の件数は、多い順。同じ内容のライブラリのサムネイルを添える', () => {
    const { db, real, file } = seed();
    for (const code of [
      'READ_FAILED',
      'HASH_MISMATCH',
      'READ_FAILED',
    ] as const) {
      recordError(db, {
        runId: real.runId,
        sourceFileId: file,
        code,
        occurredAt: T0,
      });
    }
    expect(countErrorCodes(db, {})).toEqual([
      { code: 'READ_FAILED', count: 2 },
      { code: 'HASH_MISMATCH', count: 1 },
    ]);
    const { content } = getOrCreateContent(db, {
      hash: 'c'.repeat(64),
      sizeBytes: 1,
    });
    setSourceFileContent(db, file, content.contentId);
    insertLibraryFile(db, {
      contentId: content.contentId,
      groupId: insertFileGroup(db, { stem: 'a', bucket: 'full' }),
      runId: real.runId,
      relPath: '2024/a.jpg',
      bucket: 'full',
      thumbRelPath: 'cc/x.jpg',
      createdAt: T0,
    });
    expect(
      browseErrors(db, {}, { limit: 1, offset: 0 }).items[0]?.source
        ?.thumbRelPath
    ).toBe('cc/x.jpg');
  });

  test('getBrowsedError: ID から 1 件(dry-run のものも)。なければ undefined', () => {
    const { db, dry } = seed();
    const id = recordError(db, {
      runId: dry.runId,
      code: 'EMPTY_FILE',
      occurredAt: T0,
    });
    expect(getBrowsedError(db, id)?.code).toBe('EMPTY_FILE');
    expect(getBrowsedError(db, 999)).toBeUndefined();
  });
});

describe('browseRuns・getRunDetail', () => {
  test('絞り込み(通常・dry-run・中断)と、新しい順・ページ送り', () => {
    const db = openDb();
    const normal = seedRun(db);
    const dry = seedRun(db, { isDryRun: true, uuid: 'vol-2' });
    const interrupted = seedRun(db, { uuid: 'vol-3' });
    finishRun(db, interrupted.runId, { status: 'interrupted', finishedAt: T1 });
    const ids = (filter: Parameters<typeof browseRuns>[1]) =>
      browseRuns(db, filter, { limit: 50, offset: 0 }).items.map(
        (run) => run.runId
      );
    expect(ids('all')).toEqual([interrupted.runId, dry.runId, normal.runId]);
    expect(ids('normal')).toEqual([interrupted.runId, normal.runId]);
    expect(ids('dry-run')).toEqual([dry.runId]);
    expect(ids('interrupted')).toEqual([interrupted.runId]);
    const page = browseRuns(db, 'all', { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items.map((run) => run.runId)).toEqual([dry.runId]);
  });

  test('詳細: 検出・コピー(予定)・サイズ・対象外', () => {
    const db = openDb();
    const seed = seedRun(db, { isDryRun: true });
    const planned = seedSourceFile(db, seed, {
      relPath: 'a.jpg',
      sizeBytes: 300,
    });
    const done = seedSourceFile(db, seed, { relPath: 'b.jpg', sizeBytes: 200 });
    const ignored = seedSourceFile(db, seed, {
      relPath: 'c.jpg',
      sizeBytes: 5,
    });
    seedSourceFile(db, seed, { relPath: 'd.jpg', sizeBytes: 7 });
    setSourceFileState(db, planned, 'planned');
    setSourceFileState(db, done, 'done');
    setSourceFileState(db, ignored, 'ignored');
    finishRun(db, seed.runId, {
      status: 'completed',
      finishedAt: T1,
      revisionAfter: 4,
    });
    expect(getRunDetail(db, seed.runId)).toMatchObject({
      runId: seed.runId,
      isDryRun: true,
      status: 'completed',
      revisionAfter: 4,
      detected: 4,
      copyFiles: 2,
      copyBytes: 500,
      ignored: 1,
    });
    expect(getRunDetail(db, 999)).toBeUndefined();
  });

  test('容量の見積りは、記録するまでは null。記録すると、詳細に出る(上書きもできる)', () => {
    const db = openDb();
    const seed = seedRun(db);
    expect(getRunDetail(db, seed.runId)?.capacity).toBeNull();
    recordRunCapacity(db, seed.runId, {
      requiredBytes: 130,
      destinationFreeBytes: 1800,
    });
    expect(getRunDetail(db, seed.runId)?.capacity).toEqual({
      requiredBytes: 130,
      destinationFreeBytes: 1800,
    });
    recordRunCapacity(db, seed.runId, {
      requiredBytes: 5,
      destinationFreeBytes: 6,
    });
    expect(getRunDetail(db, seed.runId)?.capacity).toEqual({
      requiredBytes: 5,
      destinationFreeBytes: 6,
    });
    expect(() =>
      recordRunCapacity(db, 999, { requiredBytes: 1, destinationFreeBytes: 1 })
    ).toThrow();
  });
});
