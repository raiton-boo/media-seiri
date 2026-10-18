import { describe, expect, test } from 'bun:test';
import { listAlbumSections, listSectionPhotos } from './album-all.ts';
import {
  albumFilterSql,
  countAlbumFilters,
  UNKNOWN_CAMERA,
} from './album-filter.ts';
import { getOrCreateContent } from './contents.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, seedSourceFile, T0 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';
import { setSourceFileContent, setSourceFileState } from './source-files.ts';
import { upsertVolume } from './volumes.ts';

type Spec = {
  rel: string;
  takenAt: string | null;
  precision?: string;
  source?: string;
  camera?: string;
  gps?: boolean;
  /** 取り込み元の実行(ドライブ)の番号 */
  run?: 'a' | 'b';
};

const build = (specs: Spec[]) => {
  const db = openDb();
  upsertVolume(db, { volumeUuid: 'va', seenAt: T0 });
  const a = seedRun(db, { uuid: 'va' });
  const b = seedRun(db, { uuid: 'vb' });
  const ids = new Map<string, number>();
  let n = 0;
  for (const spec of specs) {
    n += 1;
    const { content } = getOrCreateContent(db, {
      hash: String(n).padStart(64, 'a'),
      sizeBytes: 1,
    });
    db.query(
      `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, camera_model, gps_lat, gps_lon, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1200, 800)`
    ).run(
      content.contentId,
      spec.takenAt,
      spec.precision ?? (spec.takenAt === null ? 'none' : 'full'),
      spec.source ?? 'exif',
      spec.camera ?? null,
      spec.gps ? 35 : null,
      spec.gps ? 139 : null
    );
    const run = spec.run === 'b' ? b : a;
    ids.set(
      spec.rel,
      insertLibraryFile(db, {
        contentId: content.contentId,
        groupId: insertFileGroup(db, { stem: spec.rel, bucket: 'full' }),
        runId: run.runId,
        relPath: spec.rel,
        bucket: 'full',
        createdAt: T0,
      })
    );
    const sourceId = seedSourceFile(db, run, { relPath: `src/${spec.rel}` });
    setSourceFileContent(db, sourceId, content.contentId);
    setSourceFileState(db, sourceId, 'done');
  }
  return { db, ids, volumeA: a.volumeId, volumeB: b.volumeId };
};

const SPECS: Spec[] = [
  { rel: 'a1.jpg', takenAt: '2016-12-24T18:00:00', camera: 'Canon', gps: true },
  {
    rel: 'a2.mp4',
    takenAt: '2016-12-24T18:10:00',
    camera: 'Canon',
    source: 'video',
  },
  { rel: 'a3.cr3', takenAt: '2016-12-31T09:00:00', camera: 'Sony', run: 'b' },
  { rel: 'b1.jpg', takenAt: '2016-08-13T10:00:00' },
  {
    rel: 'b2.jpg',
    takenAt: '2014-04-06',
    precision: 'date',
    source: 'filename',
    run: 'b',
  },
  { rel: 'y1.jpg', takenAt: '2014', precision: 'year', source: 'json' },
  { rel: 'n1.jpg', takenAt: null, source: 'none' },
];

describe('listAlbumSections', () => {
  const { db } = build(SPECS);
  test('年月ごとの枚数。新しい順は、新しい年・月から。月不明は年の最後、日付なしは、いつも最後', () => {
    expect(listAlbumSections(db, {}, 'new')).toEqual([
      { year: 2016, month: 12, count: 3 },
      { year: 2016, month: 8, count: 1 },
      { year: 2014, month: 4, count: 1 },
      { year: 2014, month: 0, count: 1 },
      { year: 0, month: 0, count: 1 },
    ]);
    expect(
      listAlbumSections(db, {}, 'old').map((s) => [s.year, s.month])
    ).toEqual([
      [2014, 4],
      [2014, 0],
      [2016, 8],
      [2016, 12],
      [0, 0],
    ]);
  });
});

describe('絞り込み(albumFilterSql)', () => {
  const ctx = build(SPECS);
  const rels = (filter: Parameters<typeof listSectionPhotos>[1]) =>
    listAlbumSections(ctx.db, filter, 'new').flatMap((section) =>
      listSectionPhotos(ctx.db, filter, section, 'new', 100).map(
        (p) => p.relPath
      )
    );

  test('条件がなければ、すべて。条件の数は、数える', () => {
    expect(rels({})).toHaveLength(7);
    expect(countAlbumFilters({})).toBe(0);
    expect(
      countAlbumFilters({ kinds: ['video'], gps: true, years: [2016, 2014] })
    ).toBe(3);
    expect(albumFilterSql({})).toEqual({ sql: '', params: [] });
  });

  test('種別: 拡張子から。複数なら、どれか', () => {
    expect(rels({ kinds: ['video'] })).toEqual(['a2.mp4']);
    expect(rels({ kinds: ['raw'] })).toEqual(['a3.cr3']);
    expect(rels({ kinds: ['video', 'raw'] }).sort()).toEqual([
      'a2.mp4',
      'a3.cr3',
    ]);
    expect(rels({ kinds: ['photo'] })).toHaveLength(5);
  });

  test('カメラ: 名前。「不明」は、メタデータがないもの。複数なら、どれか', () => {
    expect(rels({ cameras: ['Canon'] }).sort()).toEqual(['a1.jpg', 'a2.mp4']);
    expect(rels({ cameras: [UNKNOWN_CAMERA] })).toHaveLength(4);
    expect(rels({ cameras: ['Sony', 'Canon'] })).toHaveLength(3);
  });

  test('GPS・年・日付の精度・取得元', () => {
    expect(rels({ gps: true })).toEqual(['a1.jpg']);
    expect(rels({ gps: false })).toHaveLength(6);
    expect(rels({ years: [2014] }).sort()).toEqual(['b2.jpg', 'y1.jpg']);
    expect(rels({ precisions: ['date', 'year'] }).sort()).toEqual([
      'b2.jpg',
      'y1.jpg',
    ]);
    expect(rels({ dateSources: ['json', 'filename'] }).sort()).toEqual([
      'b2.jpg',
      'y1.jpg',
    ]);
    expect(rels({ dateSources: ['none'] })).toEqual(['n1.jpg']);
  });

  test('ソースのドライブ: コピーしたソースのファイルの、ドライブ', () => {
    expect(rels({ volumeIds: [ctx.volumeB] }).sort()).toEqual([
      'a3.cr3',
      'b2.jpg',
    ]);
    expect(rels({ volumeIds: [ctx.volumeA] })).toHaveLength(5);
  });

  test('複数の条件は、すべてを満たすもの(AND)。区画の枚数も、絞り込みに合うものだけ', () => {
    expect(rels({ cameras: ['Canon'], kinds: ['photo'] })).toEqual(['a1.jpg']);
    expect(listAlbumSections(ctx.db, { cameras: ['Canon'] }, 'new')).toEqual([
      { year: 2016, month: 12, count: 2 },
    ]);
    expect(listAlbumSections(ctx.db, { years: [1999] }, 'new')).toEqual([]);
  });

  test('値は、SQL に埋め込まれない(拡張子や機種名に、引用符があっても、壊れない)', () => {
    expect(
      rels({ cameras: ['Can\'on"; DROP TABLE library_files; --'] })
    ).toEqual([]);
    expect(listAlbumSections(ctx.db, {}, 'new').length).toBeGreaterThan(0);
  });
});

describe('listSectionPhotos', () => {
  const { db } = build(SPECS);
  test('撮影日時の順(order の向き)。上限(limit)を守る。日付なし・月不明も、取れる', () => {
    expect(
      listSectionPhotos(db, {}, { year: 2016, month: 12 }, 'old', 10).map(
        (p) => p.relPath
      )
    ).toEqual(['a1.jpg', 'a2.mp4', 'a3.cr3']);
    expect(
      listSectionPhotos(db, {}, { year: 2016, month: 12 }, 'new', 2).map(
        (p) => p.relPath
      )
    ).toEqual(['a3.cr3', 'a2.mp4']);
    expect(
      listSectionPhotos(db, {}, { year: 0, month: 0 }, 'new', 10).map(
        (p) => p.relPath
      )
    ).toEqual(['n1.jpg']);
    expect(
      listSectionPhotos(db, {}, { year: 2014, month: 0 }, 'new', 10).map(
        (p) => p.relPath
      )
    ).toEqual(['y1.jpg']);
    const [video] = listSectionPhotos(
      db,
      {},
      { year: 2016, month: 12 },
      'old',
      10
    ).filter((p) => p.kind === 'video');
    expect(video?.relPath).toBe('a2.mp4');
  });
});
