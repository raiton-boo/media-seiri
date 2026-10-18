import { describe, expect, test } from 'bun:test';
import { getOrCreateContent } from './contents.ts';
import {
  browseDuplicateGroups,
  getDuplicateGroup,
} from './duplicate-browse.ts';
import { insertDuplicateLink } from './duplicate-links.ts';
import {
  browseDateFallbacks,
  countDateFallbacks,
  listSourceVolumes,
} from './fallback-browse.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, seedSourceFile, T0 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';
import { setSourceFileContent, setSourceFileState } from './source-files.ts';
import { upsertVolume } from './volumes.ts';

type Db = ReturnType<typeof openDb>;
let counter = 0;

/** 内容・メタデータ・ライブラリのファイルを作り、コピー済みのソースのファイルと結ぶ */
const addFile = (
  db: Db,
  seed: { volumeId: number; runId: number },
  options: {
    relPath: string;
    source: string;
    precision?: string;
    takenAt?: string | null;
    dateSource: 'exif' | 'json' | 'filename' | 'none';
    reason?: string;
    thumb?: string;
    sourcePath?: string;
  }
): { libraryFileId: number; contentId: number } => {
  counter += 1;
  const { content } = getOrCreateContent(db, {
    hash: String(counter).padStart(64, 'b'),
    sizeBytes: 100 + counter,
  });
  db.query(
    `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, date_reason, mtime_ref_ms, camera_make, camera_model)
     VALUES (?, ?, ?, ?, ?, ?, 'Canon', 'EOS')`
  ).run(
    content.contentId,
    options.takenAt ?? null,
    options.precision ?? 'full',
    options.dateSource,
    options.reason ?? '',
    1_700_000_000_000
  );
  const libraryFileId = insertLibraryFile(db, {
    contentId: content.contentId,
    groupId: insertFileGroup(db, { stem: options.relPath, bucket: 'full' }),
    runId: seed.runId,
    relPath: options.relPath,
    bucket: 'full',
    ...(options.thumb ? { thumbRelPath: options.thumb } : {}),
    createdAt: T0,
  });
  const sourceId = seedSourceFile(db, seed, {
    relPath: options.sourcePath ?? options.source,
  });
  setSourceFileContent(db, sourceId, content.contentId);
  setSourceFileState(db, sourceId, 'done');
  return { libraryFileId, contentId: content.contentId };
};

describe('browseDateFallbacks・countDateFallbacks', () => {
  const seed = () => {
    const db = openDb();
    upsertVolume(db, { volumeUuid: 'vol-1', label: 'Backup', seenAt: T0 });
    const first = seedRun(db);
    const second = seedRun(db, { uuid: 'vol-2' });
    addFile(db, first, {
      relPath: '2024/a.jpg',
      source: 'DCIM/a.jpg',
      dateSource: 'exif',
      takenAt: '2024-03-05T10:00:00',
    });
    addFile(db, first, {
      relPath: '2015/b.jpg',
      source: 'DCIM/IMG_20150704.jpg',
      dateSource: 'filename',
      precision: 'date',
      takenAt: '2015-07-04',
      reason: 'ファイル名から',
    });
    addFile(db, second, {
      relPath: '2016/c.jpg',
      source: 'X/c.jpg',
      dateSource: 'json',
      precision: 'full',
      takenAt: '2016-01-01T00:00:00',
      reason: 'Takeout の json',
    });
    addFile(db, second, {
      relPath: '_unknown/日付なし/d.jpg',
      source: 'X/d.jpg',
      dateSource: 'none',
      precision: 'none',
      reason: 'どこからも取れない',
    });
    return { db, first, second };
  };

  test('本体(exif)以外から日付を決めたものだけを、新しい順に返す。元の場所・理由・参考の更新日を添える', () => {
    const { db } = seed();
    const { total, items } = browseDateFallbacks(
      db,
      {},
      { limit: 50, offset: 0 }
    );
    expect(total).toBe(3);
    expect(items.map((item) => item.dateSource)).toEqual([
      'none',
      'json',
      'filename',
    ]);
    expect(items[2]).toMatchObject({
      libraryRelPath: '2015/b.jpg',
      source: {
        volumeLabel: 'Backup',
        relPath: 'DCIM/IMG_20150704.jpg',
        entryPath: null,
      },
      takenAt: '2015-07-04',
      datePrecision: 'date',
      dateReason: 'ファイル名から',
      mtimeRefMs: 1_700_000_000_000,
    });
    expect(items[0]?.takenAt).toBeNull();
  });

  test('取得元・精度・ドライブ・実行で絞り込み、ページ送りできる', () => {
    const { db, first, second } = seed();
    const rel = (filter: Parameters<typeof browseDateFallbacks>[1]) =>
      browseDateFallbacks(db, filter, { limit: 50, offset: 0 }).items.map(
        (item) => item.libraryRelPath
      );
    expect(rel({ dateSource: 'json' })).toEqual(['2016/c.jpg']);
    expect(rel({ precision: 'none' })).toEqual(['_unknown/日付なし/d.jpg']);
    expect(rel({ runId: first.runId })).toEqual(['2015/b.jpg']);
    expect(rel({ volumeId: second.volumeId })).toEqual([
      '_unknown/日付なし/d.jpg',
      '2016/c.jpg',
    ]);
    const page = browseDateFallbacks(db, {}, { limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.dateSource)).toEqual(['json']);
  });

  test('取得元ごとの件数と、ソースのドライブの選択肢', () => {
    const { db } = seed();
    expect(countDateFallbacks(db)).toEqual({ json: 1, filename: 1, none: 1 });
    expect(listSourceVolumes(db).map((volume) => volume.label)).toEqual([
      'Backup',
      null,
    ]);
  });
});

describe('browseDuplicateGroups・getDuplicateGroup', () => {
  const seed = () => {
    const db = openDb();
    upsertVolume(db, { volumeUuid: 'vol-1', label: 'Backup', seenAt: T0 });
    const real = seedRun(db);
    const other = seedRun(db, { uuid: 'vol-2' });
    const dry = seedRun(db, { isDryRun: true, uuid: 'vol-3' });
    const a = addFile(db, real, {
      relPath: '2014/04/a.jpg',
      source: 'DCIM/a.jpg',
      dateSource: 'exif',
      takenAt: '2014-04-06T15:32:03',
      thumb: 'bb/x.jpg',
    });
    const b = addFile(db, real, {
      relPath: '2014/05/b.jpg',
      source: 'DCIM/b.jpg',
      dateSource: 'exif',
      takenAt: '2014-05-01T00:00:00',
    });
    const link = (
      run: { volumeId: number; runId: number },
      path: string,
      libraryFileId: number
    ) =>
      insertDuplicateLink(db, {
        skippedSourceFileId: seedSourceFile(db, run, { relPath: path }),
        adoptedLibraryFileId: libraryFileId,
        createdAt: T0,
      });
    link(real, 'Copy/a1.jpg', a.libraryFileId);
    link(other, 'Copy/a2.jpg', a.libraryFileId);
    link(other, 'Copy/b1.jpg', b.libraryFileId);
    link(dry, 'Dry/a3.jpg', a.libraryFileId);
    return { db, real, other, dry, a, b };
  };

  test('採用側ごとに、スキップの数をまとめて返す。dry-run のスキップは、指定がなければ、数えない', () => {
    const { db, a, b } = seed();
    const result = browseDuplicateGroups(db, {}, { limit: 50, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.totalSkipped).toBe(3);
    expect(
      result.items.map((group) => [
        group.adoptedLibraryFileId,
        group.skippedCount,
      ])
    ).toEqual([
      [b.libraryFileId, 1],
      [a.libraryFileId, 2],
    ]);
    expect(result.items[1]).toMatchObject({
      adoptedRelPath: '2014/04/a.jpg',
      thumbRelPath: 'bb/x.jpg',
    });
  });

  test('ドライブ・実行(dry-run でも)・ファイル名で絞り込む。ページ送りもできる', () => {
    const { db, real, other, dry, a } = seed();
    const count = (filter: Parameters<typeof browseDuplicateGroups>[1]) =>
      browseDuplicateGroups(db, filter, { limit: 50, offset: 0 });
    expect(count({ volumeId: real.volumeId }).totalSkipped).toBe(1);
    expect(count({ runId: other.runId }).totalSkipped).toBe(2);
    expect(
      count({ runId: dry.runId }).items.map((g) => g.adoptedLibraryFileId)
    ).toEqual([a.libraryFileId]);
    expect(count({ query: 'b1' }).items).toHaveLength(1);
    expect(
      count({ query: 'a.jpg' }).items.map((g) => g.adoptedRelPath)
    ).toEqual(['2014/04/a.jpg']);
    // `%` や `_` は、文字どおりに探す
    expect(count({ query: '%' }).total).toBe(0);
    expect(
      browseDuplicateGroups(db, {}, { limit: 1, offset: 1 }).items
    ).toHaveLength(1);
  });

  test('比較用の詳細: 採用側のメタデータ・サイズと、スキップ側すべて(新しい順)', () => {
    const { db, a, dry } = seed();
    const detail = getDuplicateGroup(db, a.libraryFileId);
    expect(detail?.adopted).toMatchObject({
      relPath: '2014/04/a.jpg',
      takenAt: '2014-04-06T15:32:03',
      cameraMake: 'Canon',
      thumbRelPath: 'bb/x.jpg',
    });
    expect(detail?.skipped.map((s) => s.relPath)).toEqual([
      'Dry/a3.jpg',
      'Copy/a2.jpg',
      'Copy/a1.jpg',
    ]);
    expect(detail?.skipped[0]).toMatchObject({
      runId: dry.runId,
      isDryRun: true,
    });
    expect(detail?.skipped[2]?.volumeLabel).toBe('Backup');
    expect(getDuplicateGroup(db, 999)).toBeUndefined();
  });
});
