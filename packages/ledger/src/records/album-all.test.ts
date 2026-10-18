import { describe, expect, test } from 'bun:test';
import { listAlbumSections, listSectionPhotos } from './album-all.ts';
import { listAutoAlbums, listLatestEvents } from './album-auto.ts';
import { listMonthSummaries, listYearCounts } from './album-browse.ts';
import {
  getDaySummary,
  listCalendarDays,
  listCalendarYears,
} from './album-calendar.ts';
import { listFilterOptions } from './album-facets.ts';
import {
  albumFilterSql,
  countAlbumFilters,
  NO_PLACE,
  UNKNOWN_CAMERA,
} from './album-filter.ts';
import { getPhotoDetail, getPhotoStrip } from './album-photo.ts';
import {
  countFilteredPhotos,
  describePlace,
  listFilteredPhotos,
  listGpsCells,
  parseDateQuery,
  suggestSearch,
} from './album-search.ts';
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

describe('listFilterOptions(選択肢と件数)', () => {
  const ctx = build(SPECS);
  test('条件がなければ、全体の件数', () => {
    const options = listFilterOptions(ctx.db, {});
    expect(options.kinds).toEqual([
      { value: 'photo', count: 5 },
      { value: 'video', count: 1 },
      { value: 'raw', count: 1 },
    ]);
    expect(options.cameras).toEqual([
      { value: 'Canon', count: 2 },
      { value: 'Sony', count: 1 },
      { value: UNKNOWN_CAMERA, count: 4 },
    ]);
    expect(options.gps).toEqual({ with: 1, without: 6 });
    expect(options.years).toEqual([
      { value: 2016, count: 4 },
      { value: 2014, count: 2 },
    ]);
    expect(options.volumes.map((v) => v.count)).toEqual([5, 2]);
  });

  test('その項目自身の条件は外して数え、ほかの条件には、従う', () => {
    const options = listFilterOptions(ctx.db, {
      kinds: ['video'],
      cameras: ['Canon'],
    });
    // 種別: カメラ Canon だけに絞った中での、写真・動画・RAW
    expect(options.kinds).toEqual([
      { value: 'photo', count: 1 },
      { value: 'video', count: 1 },
      { value: 'raw', count: 0 },
    ]);
    // カメラ: 動画だけに絞った中での、カメラ
    expect(options.cameras).toEqual([{ value: 'Canon', count: 1 }]);
  });
});

describe('年・月の集計に、絞り込みが効く', () => {
  const ctx = build(SPECS);
  test('年ごとの枚数・日付なしの枚数', () => {
    expect(listYearCounts(ctx.db, 'new', { kinds: ['photo'] })).toEqual({
      years: [
        { year: 2016, count: 2 },
        { year: 2014, count: 2 },
      ],
      undated: 1,
      total: 5,
    });
  });
  test('月の枚数と代表', () => {
    const months = listMonthSummaries(ctx.db, 2016, 'old', { gps: true });
    expect(
      months.filter((m) => m.count > 0).map((m) => [m.month, m.count])
    ).toEqual([[12, 1]]);
  });
});

describe('検索の条件(日付・名前・場所)', () => {
  const ctx = build(SPECS);
  test('日付: 年・月・日の前方一致。複数なら、どれか', () => {
    expect(countFilteredPhotos(ctx.db, { dates: ['2016'] })).toBe(4);
    expect(countFilteredPhotos(ctx.db, { dates: ['2016-12-24'] })).toBe(2);
    expect(countFilteredPhotos(ctx.db, { dates: ['2016-08', '2014-04'] })).toBe(
      2
    );
  });
  test('名前: ファイル名に含む(大文字小文字は区別しない。ディレクトリ名は含めない。% と _ は、そのまま)', () => {
    expect(countFilteredPhotos(ctx.db, { names: ['A1'] })).toBe(1);
    expect(countFilteredPhotos(ctx.db, { names: ['.jpg'] })).toBe(5);
    expect(countFilteredPhotos(ctx.db, { names: ['%'] })).toBe(0);
    expect(countFilteredPhotos(ctx.db, { names: ['a1', 'b1'] })).toBe(2);
  });
  test('場所: GPS の格子。種類の違う条件は、AND', () => {
    expect(
      countFilteredPhotos(ctx.db, { places: [{ lat: 35, lon: 139 }] })
    ).toBe(1);
    expect(
      countFilteredPhotos(ctx.db, { places: [{ lat: 36, lon: 139 }] })
    ).toBe(0);
    expect(
      countFilteredPhotos(ctx.db, { names: ['a'], dates: ['2016-12'] })
    ).toBe(3);
  });
  test('写真の一覧: 日付のないものは最後。ページ送りができる', () => {
    const all = listFilteredPhotos(ctx.db, {}, 'new', {
      limit: 100,
      offset: 0,
    });
    expect(all.map((p) => p.relPath)[all.length - 1]).toBe('n1.jpg');
    const page = listFilteredPhotos(ctx.db, {}, 'new', { limit: 2, offset: 2 });
    expect(page.map((p) => p.relPath)).toEqual(
      all.slice(2, 4).map((p) => p.relPath)
    );
  });
});

describe('parseDateQuery', () => {
  test('いろいろな書き方を、そろえる', () => {
    expect(parseDateQuery('2014')).toBe('2014');
    expect(parseDateQuery('2014年4月')).toBe('2014-04');
    expect(parseDateQuery('2014/4/2')).toBe('2014-04-02');
    expect(parseDateQuery('2014年4月12日')).toBe('2014-04-12');
    expect(parseDateQuery('2014-')).toBe('2014');
  });
  test('日付でないものは、undefined', () => {
    expect(parseDateQuery('2014-13')).toBeUndefined();
    expect(parseDateQuery('2014-04-32')).toBeUndefined();
    expect(parseDateQuery('abc')).toBeUndefined();
    expect(parseDateQuery('')).toBeUndefined();
  });
});

describe('suggestSearch(候補)', () => {
  const ctx = build(SPECS);
  test('日付: 件数つき。件数 0 は出さない', () => {
    expect(suggestSearch(ctx.db, '2016年12月', {})).toEqual([
      { type: 'date', value: '2016-12', label: '2016年12月', count: 3 },
    ]);
    expect(suggestSearch(ctx.db, '1999', {})).toEqual([]);
  });
  test('名前: 「含む」と、具体的なファイル名。カメラ: 機種名の一部', () => {
    const found = suggestSearch(ctx.db, 'a1', {});
    expect(found[0]).toMatchObject({
      type: 'name',
      label: '名前に「a1」を含む',
      count: 1,
    });
    expect(found.some((c) => c.type === 'name' && c.value === 'a1.jpg')).toBe(
      true
    );
    expect(suggestSearch(ctx.db, 'cano', {})).toEqual([
      { type: 'camera', value: 'Canon', label: 'Canon', count: 2 },
    ]);
  });
  test('入力が空なら、場所とカメラ。場所は座標のまとまりで出す', () => {
    const found = suggestSearch(ctx.db, '', {});
    expect(found.find((c) => c.type === 'place')).toEqual({
      type: 'place',
      value: { lat: 35, lon: 139 },
      label: describePlace({ lat: 35, lon: 139 }),
      count: 1,
    });
    expect(found.some((c) => c.type === 'camera' && c.value === 'Canon')).toBe(
      true
    );
  });
  test('件数は、いまの条件に、その候補を足した結果', () => {
    expect(suggestSearch(ctx.db, 'cano', { kinds: ['video'] })).toEqual([
      { type: 'camera', value: 'Canon', label: 'Canon', count: 1 },
    ]);
  });
});

describe('拡大表示(getPhotoDetail・getPhotoStrip)', () => {
  const ctx = build(SPECS);
  const id = (rel: string) => ctx.ids.get(rel) as number;

  test('情報: メタデータ・GPS・内容(ハッシュ・大きさ)。ないものは、null', () => {
    expect(getPhotoDetail(ctx.db, id('a1.jpg'))).toMatchObject({
      relPath: 'a1.jpg',
      kind: 'photo',
      takenAt: '2016-12-24T18:00:00',
      datePrecision: 'full',
      dateSource: 'exif',
      cameraModel: 'Canon',
      width: 1200,
      gps: { lat: 35, lon: 139 },
      sizeBytes: 1,
      event: null,
    });
    expect(getPhotoDetail(ctx.db, id('b1.jpg'))?.gps).toBeNull();
    expect(getPhotoDetail(ctx.db, 99999)).toBeUndefined();
  });

  test('同名グループ: 自分を含め、写真・RAW・サイドカーの順', () => {
    const base = getPhotoDetail(ctx.db, id('a1.jpg'));
    const groupId = (
      ctx.db
        .query<{ g: number }, [number]>(
          'SELECT group_id AS g FROM library_files WHERE library_file_id = ?'
        )
        .get(id('a1.jpg')) as { g: number }
    ).g;
    for (const [rel, n] of [
      ['a1.xmp', 'x'],
      ['a1.cr3', 'r'],
    ] as const) {
      const { content } = getOrCreateContent(ctx.db, {
        hash: n.repeat(64),
        sizeBytes: 5,
      });
      insertLibraryFile(ctx.db, {
        contentId: content.contentId,
        groupId,
        runId: 1,
        relPath: rel,
        bucket: 'full',
        createdAt: T0,
      });
    }
    expect(base).not.toBeNull();
    expect(
      getPhotoDetail(ctx.db, id('a1.jpg'))?.group.map((m) => [
        m.relPath,
        m.kind,
      ])
    ).toEqual([
      ['a1.jpg', 'photo'],
      ['a1.cr3', 'raw'],
      ['a1.xmp', 'xmp'],
    ]);
  });

  test('前後の並び: 位置・前後 radius 枚。日付なしは最後。条件に合わない写真は、位置なし', () => {
    const strip = getPhotoStrip(ctx.db, id('b1.jpg'), {}, 'new', 1);
    // 新しい順: a3(12/31) a2(12/24 18:10) a1 b1 b2 y1 n1
    expect(strip.total).toBe(7);
    expect(strip.position).toBe(4);
    expect(strip.photos.map((p) => p.relPath)).toEqual([
      'a1.jpg',
      'b1.jpg',
      'b2.jpg',
    ]);
    const first = getPhotoStrip(ctx.db, id('a3.cr3'), {}, 'new', 2);
    expect(first.position).toBe(1);
    expect(first.photos).toHaveLength(3);
    const old = getPhotoStrip(ctx.db, id('y1.jpg'), {}, 'old', 1);
    // 古い順: y1('2014') b2('2014-04-06') b1 …(y1 が、いちばん最初)
    expect(old.position).toBe(1);
    expect(old.photos.map((p) => p.relPath)).toEqual(['y1.jpg', 'b2.jpg']);
    const filtered = getPhotoStrip(
      ctx.db,
      id('b1.jpg'),
      { kinds: ['video'] },
      'new',
      1
    );
    expect(filtered).toEqual({ total: 1, position: null, photos: [] });
  });

  test('できごとの範囲', () => {
    ctx.db
      .query(
        "INSERT INTO album_events (start_at, end_at, file_count, cover_library_file_id, rule, computed_revision) VALUES (?, ?, 2, NULL, '4h', 1)"
      )
      .run('2016-12-24T18:00:00', '2016-12-24T18:10:00');
    const eventId = ctx.db
      .query<{ i: number }, []>(
        'SELECT max(album_event_id) AS i FROM album_events'
      )
      .get()?.i as number;
    ctx.db
      .query(
        'UPDATE library_files SET album_event_id = ? WHERE library_file_id IN (?, ?)'
      )
      .run(eventId, id('a1.jpg'), id('a2.mp4'));
    const strip = getPhotoStrip(ctx.db, id('a1.jpg'), { eventId }, 'new', 5);
    expect(strip).toMatchObject({ total: 2, position: 2 });
    expect(getPhotoDetail(ctx.db, id('a1.jpg'))?.event).toMatchObject({
      albumEventId: eventId,
      fileCount: 2,
    });
  });
});

describe('listGpsCells・NO_PLACE', () => {
  const ctx = build(SPECS);
  test('GPS のある写真の、格子ごとの枚数(条件も効く)', () => {
    expect(listGpsCells(ctx.db, {})).toEqual([{ lat: 35, lon: 139, count: 1 }]);
    expect(listGpsCells(ctx.db, { kinds: ['video'] })).toEqual([]);
  });
  test('NO_PLACE は、どの写真にも合わない', () => {
    expect(countFilteredPhotos(ctx.db, { places: [NO_PLACE] })).toBe(0);
  });
});

describe('カレンダー', () => {
  const ctx = build(SPECS);
  test('年の、日ごとの枚数。年・月だけの日付と、日付なしは、載らない', () => {
    expect(listCalendarDays(ctx.db, 2016, {})).toEqual([
      { date: '2016-08-13', count: 1 },
      { date: '2016-12-24', count: 2 },
      { date: '2016-12-31', count: 1 },
    ]);
    // 2014: 4/6 の 1 枚だけ(`2014` は年だけなので、載らない)
    expect(listCalendarDays(ctx.db, 2014, {})).toEqual([
      { date: '2014-04-06', count: 1 },
    ]);
    expect(listCalendarDays(ctx.db, 2016, { kinds: ['video'] })).toEqual([
      { date: '2016-12-24', count: 1 },
    ]);
  });
  test('年の一覧(新しい年が先)', () => {
    expect(listCalendarYears(ctx.db, {})).toEqual([
      { year: 2016, count: 4 },
      { year: 2014, count: 1 },
    ]);
  });
  test('選んだ日のまとめ: 枚数・最初と最後の時刻・GPS', () => {
    expect(getDaySummary(ctx.db, '2016-12-24', {})).toEqual({
      count: 2,
      firstClock: '18:00',
      lastClock: '18:10',
      gpsCount: 1,
    });
    // 時刻のない日(精度が date)
    expect(getDaySummary(ctx.db, '2014-04-06', {})).toEqual({
      count: 1,
      firstClock: null,
      lastClock: null,
      gpsCount: 0,
    });
    expect(getDaySummary(ctx.db, '1999-01-01', {}).count).toBe(0);
  });
});

describe('自動アルバム', () => {
  const ctx = build(SPECS);
  const id = (rel: string) => ctx.ids.get(rel) as number;

  test('切り口ごとの件数と、条件。ライブフォトは、組で数える(いまは、なし)', () => {
    const albums = listAutoAlbums(ctx.db);
    const byTitle = new Map(albums.map((album) => [album.title, album]));
    expect(byTitle.get('動画')).toMatchObject({
      count: 1,
      unit: '本',
      filter: { kinds: ['video'] },
    });
    expect(byTitle.get('RAW')).toMatchObject({ count: 1, unit: '枚' });
    expect(byTitle.get('場所のある写真')).toMatchObject({
      count: 1,
      filter: { gps: true },
    });
    // 日付フォールバック: json と filename の 2 枚。日付なし: 1 枚
    expect(byTitle.get('日付フォールバック')?.count).toBe(2);
    expect(byTitle.get('日付なし')?.count).toBe(1);
    // カメラ別: 多い順(Canon 2・Sony 1)。「不明」は、出さない
    expect(
      albums.filter((a) => a.kind === 'camera').map((a) => [a.title, a.count])
    ).toEqual([
      ['Canon', 2],
      ['Sony', 1],
    ]);
    expect(byTitle.has('ライブフォト')).toBe(false);
  });

  test('ライブフォト: 同名グループに、写真と動画の両方がある組', () => {
    const groupId = (
      ctx.db
        .query<{ g: number }, [number]>(
          'SELECT group_id AS g FROM library_files WHERE library_file_id = ?'
        )
        .get(id('b1.jpg')) as { g: number }
    ).g;
    const { content } = getOrCreateContent(ctx.db, {
      hash: 'l'.repeat(64),
      sizeBytes: 9,
    });
    ctx.db
      .query(
        `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, width, height, duration_sec)
         VALUES (?, '2016-08-13T10:00:01', 'full', 'exif', 1200, 800, 2.5)`
      )
      .run(content.contentId);
    insertLibraryFile(ctx.db, {
      contentId: content.contentId,
      groupId,
      runId: 1,
      relPath: 'b1.mov',
      bucket: 'full',
      createdAt: T0,
    });
    const live = listAutoAlbums(ctx.db).find((album) => album.kind === 'live');
    expect(live).toMatchObject({ count: 1, unit: '組' });
    // 条件としては、写真も動画も(2 枚)
    expect(countFilteredPhotos(ctx.db, { livePhotos: true })).toBe(2);
  });

  test('できごとの一覧: 新しい順。カメラ・GPS・動画の数・代表', () => {
    ctx.db
      .query(
        "INSERT INTO album_events (start_at, end_at, file_count, cover_library_file_id, rule, computed_revision) VALUES ('2016-12-24T18:00:00', '2016-12-24T18:10:00', 2, NULL, '4h', 1)"
      )
      .run();
    ctx.db
      .query(
        "INSERT INTO album_events (start_at, end_at, file_count, cover_library_file_id, rule, computed_revision) VALUES ('2016-08-13T10:00:00', '2016-08-13T10:00:00', 1, NULL, '4h', 1)"
      )
      .run();
    const ids = ctx.db
      .query<{ i: number; s: string }, []>(
        'SELECT album_event_id AS i, start_at AS s FROM album_events'
      )
      .all();
    const eventOf = (start: string) =>
      ids.find((row) => row.s === start)?.i as number;
    ctx.db
      .query(
        'UPDATE library_files SET album_event_id = ? WHERE library_file_id IN (?, ?)'
      )
      .run(eventOf('2016-12-24T18:00:00'), id('a1.jpg'), id('a2.mp4'));
    ctx.db
      .query(
        'UPDATE library_files SET album_event_id = ? WHERE library_file_id = ?'
      )
      .run(eventOf('2016-08-13T10:00:00'), id('b1.jpg'));
    const events = listLatestEvents(ctx.db, 'new', 10);
    expect(events.map((e) => e.startAt)).toEqual([
      '2016-12-24T18:00:00',
      '2016-08-13T10:00:00',
    ]);
    expect(events[0]).toMatchObject({
      fileCount: 2,
      camera: 'Canon',
      gpsCount: 1,
      videoCount: 1,
    });
    expect(listLatestEvents(ctx.db, 'old', 1)[0]?.startAt).toBe(
      '2016-08-13T10:00:00'
    );
    // サムネイルがなければ、代表なし
    expect(events[0]?.cover).toBeNull();
  });
});
