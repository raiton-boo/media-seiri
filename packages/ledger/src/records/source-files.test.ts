import { describe, expect, test } from 'bun:test';
import {
  openDb,
  seedContent,
  seedRun,
  seedSourceFile,
  T1,
} from './fixtures.ts';
import { finishRun } from './runs.ts';
import {
  countSourceFilesByState,
  findProcessedSourceFile,
  findSourceFileInRun,
  getSourceFile,
  insertSourceFile,
  listSourceFiles,
  listSourceFilesByContent,
  setSourceFileContent,
  setSourceFileState,
  toSourceFileKind,
} from './source-files.ts';

describe('source_files', () => {
  test('記録すると scanned。更新日は、小数のミリ秒を切り捨てて保存する', () => {
    const db = openDb();
    const seed = seedRun(db);
    const id = seedSourceFile(db, seed, { mtimeMs: 1_700_000_000_123.9 });
    expect(getSourceFile(db, id)).toEqual({
      sourceFileId: id,
      runId: seed.runId,
      volumeId: seed.volumeId,
      containerId: null,
      zipDepth: 0,
      relPath: 'DCIM/IMG_0001.JPG',
      entryPath: null,
      sizeBytes: 100,
      mtimeMs: 1_700_000_000_123,
      kind: 'photo',
      ext: 'jpg',
      contentId: null,
      state: 'scanned',
      ignoreReason: null,
    });
    expect(getSourceFile(db, 999)).toBeUndefined();
  });

  test('ZIP の中身は、親の ZIP と ZIP 内のパスで記録する', () => {
    const db = openDb();
    const seed = seedRun(db);
    const zip = seedSourceFile(db, seed, {
      relPath: 'a.zip',
      ext: 'zip',
      kind: 'sidecar',
    });
    const entry = insertSourceFile(db, {
      ...seed,
      relPath: 'a.zip',
      containerId: zip,
      entryPath: 'x/IMG.JPG',
      zipDepth: 1,
      sizeBytes: 5,
      mtimeMs: 0,
      kind: 'photo',
      ext: 'jpg',
    });
    expect(getSourceFile(db, entry)).toMatchObject({
      containerId: zip,
      entryPath: 'x/IMG.JPG',
      zipDepth: 1,
    });
  });

  test('同じ実行の同じファイルは、2 度記録できない', () => {
    const db = openDb();
    const seed = seedRun(db);
    seedSourceFile(db, seed);
    expect(() => seedSourceFile(db, seed)).toThrow();
  });

  test('状態を変える(対象外の理由つき)。ないファイルは、エラー', () => {
    const db = openDb();
    const id = seedSourceFile(db, seedRun(db));
    setSourceFileState(db, id, 'ignored', '対象外の拡張子');
    expect(getSourceFile(db, id)).toMatchObject({
      state: 'ignored',
      ignoreReason: '対象外の拡張子',
    });
    setSourceFileState(db, id, 'analyzed');
    expect(getSourceFile(db, id)).toMatchObject({
      state: 'analyzed',
      ignoreReason: null,
    });
    expect(() => setSourceFileState(db, 999, 'done')).toThrow();
    expect(() => setSourceFileContent(db, 999, 1)).toThrow();
  });

  test('内容を結びつけ、同じ内容のファイルを探せる', () => {
    const db = openDb();
    const seed = seedRun(db);
    const content = seedContent(db);
    const a = seedSourceFile(db, seed, { relPath: 'a.jpg' });
    const b = seedSourceFile(db, seed, { relPath: 'b.jpg' });
    seedSourceFile(db, seed, { relPath: 'c.jpg' });
    setSourceFileContent(db, a, content);
    setSourceFileContent(db, b, content);
    expect(
      listSourceFilesByContent(db, content).map((file) => file.sourceFileId)
    ).toEqual([a, b]);
    expect(() => setSourceFileContent(db, a, 999)).toThrow();
  });

  test('実行ごとに、状態別の一覧と件数', () => {
    const db = openDb();
    const seed = seedRun(db);
    const a = seedSourceFile(db, seed, { relPath: 'a.jpg' });
    const b = seedSourceFile(db, seed, { relPath: 'b.jpg' });
    seedSourceFile(db, seed, { relPath: 'c.jpg' });
    setSourceFileState(db, a, 'done');
    setSourceFileState(db, b, 'done');
    expect(
      listSourceFiles(db, seed.runId, 'done').map((file) => file.sourceFileId)
    ).toEqual([a, b]);
    expect(countSourceFilesByState(db, seed.runId)).toEqual({
      done: 2,
      scanned: 1,
    });
    expect(countSourceFilesByState(db, 999)).toEqual({});
  });
});

describe('toSourceFileKind', () => {
  test('xmp は sidecar。json と unsupported は、台帳に記録しない', () => {
    expect(toSourceFileKind('photo')).toBe('photo');
    expect(toSourceFileKind('raw')).toBe('raw');
    expect(toSourceFileKind('video')).toBe('video');
    expect(toSourceFileKind('xmp')).toBe('sidecar');
    expect(toSourceFileKind('json')).toBeUndefined();
    expect(toSourceFileKind('unsupported')).toBeUndefined();
  });
});

describe('findProcessedSourceFile(再実行で、処理済みを探す)', () => {
  const key = (volumeId: number) => ({
    volumeId,
    relPath: 'DCIM/IMG_0001.JPG',
    sizeBytes: 100,
    mtimeMs: 1_700_000_000_123.4,
  });

  test('done か duplicate で、キーが同じものが見つかる(更新日は、同じ丸め方で比べる)', () => {
    const db = openDb();
    const seed = seedRun(db);
    const id = seedSourceFile(db, seed);
    expect(findProcessedSourceFile(db, key(seed.volumeId))).toBeUndefined();
    setSourceFileState(db, id, 'done');
    expect(findProcessedSourceFile(db, key(seed.volumeId))?.sourceFileId).toBe(
      id
    );
    setSourceFileState(db, id, 'duplicate');
    expect(findProcessedSourceFile(db, key(seed.volumeId))?.sourceFileId).toBe(
      id
    );
    setSourceFileState(db, id, 'error');
    expect(findProcessedSourceFile(db, key(seed.volumeId))).toBeUndefined();
  });

  test('サイズか更新日が違えば、処理済みではない', () => {
    const db = openDb();
    const seed = seedRun(db);
    setSourceFileState(db, seedSourceFile(db, seed), 'done');
    expect(
      findProcessedSourceFile(db, { ...key(seed.volumeId), sizeBytes: 101 })
    ).toBeUndefined();
    expect(
      findProcessedSourceFile(db, {
        ...key(seed.volumeId),
        mtimeMs: 1_700_000_000_124,
      })
    ).toBeUndefined();
  });

  test('dry-run の実行と、ZIP の中身は、処理済みに数えない', () => {
    const db = openDb();
    const dry = seedRun(db, { isDryRun: true });
    setSourceFileState(db, seedSourceFile(db, dry), 'done');
    expect(findProcessedSourceFile(db, key(dry.volumeId))).toBeUndefined();

    const real = seedRun(db);
    const zip = seedSourceFile(db, real, {
      relPath: 'a.zip',
      ext: 'zip',
      kind: 'sidecar',
    });
    const entry = insertSourceFile(db, {
      ...real,
      relPath: 'DCIM/IMG_0001.JPG',
      containerId: zip,
      entryPath: 'IMG_0001.JPG',
      sizeBytes: 100,
      mtimeMs: 1_700_000_000_123,
      kind: 'photo',
      ext: 'jpg',
    });
    setSourceFileState(db, entry, 'done');
    expect(findProcessedSourceFile(db, key(real.volumeId))).toBeUndefined();
  });

  test('前の実行で処理済みのものを、あとの実行から見つけられる', () => {
    const db = openDb();
    const first = seedRun(db);
    const id = seedSourceFile(db, first);
    setSourceFileState(db, id, 'done');
    finishRun(db, first.runId, { status: 'completed', finishedAt: T1 });
    expect(findProcessedSourceFile(db, key(first.volumeId))?.runId).toBe(
      first.runId
    );
  });
});

describe('findSourceFileInRun', () => {
  test('同じ実行の、同じパスの行を探す(別の実行・ZIP の中身・別のパスは、見つからない)', () => {
    const db = openDb();
    const first = seedRun(db);
    const id = seedSourceFile(db, first);
    const key = {
      runId: first.runId,
      volumeId: first.volumeId,
      relPath: 'DCIM/IMG_0001.JPG',
    };
    expect(findSourceFileInRun(db, key)?.sourceFileId).toBe(id);
    expect(
      findSourceFileInRun(db, { ...key, relPath: 'DCIM/none.jpg' })
    ).toBeUndefined();
    expect(
      findSourceFileInRun(db, { ...key, runId: key.runId + 1 })
    ).toBeUndefined();

    const zip = seedSourceFile(db, first, {
      relPath: 'a.zip',
      ext: 'zip',
      kind: 'sidecar',
    });
    insertSourceFile(db, {
      ...first,
      relPath: 'a.zip',
      containerId: zip,
      entryPath: 'x.jpg',
      zipDepth: 1,
      sizeBytes: 1,
      mtimeMs: 0,
      kind: 'photo',
      ext: 'jpg',
    });
    expect(
      findSourceFileInRun(db, { ...key, relPath: 'a.zip' })?.sourceFileId
    ).toBe(zip);
  });
});
