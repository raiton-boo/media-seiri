import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSnapshot,
  findDuplicateLinkBySource,
  getRevision,
  incrementRevision,
  insertFileGroup,
  insertLibraryFile,
  insertSourceFile,
  setSourceFileState,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addFile,
  addPhoto,
  addVideo,
  DATE_2024_03_05,
  initLibrary,
  makeWorld,
  NOW,
  openWorldLedger,
  runIn,
  useExifWriter,
  type World,
} from './test-support.ts';

useExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

const newWorld = async (
  options?: Parameters<typeof makeWorld>[0]
): Promise<World> => {
  const world = makeWorld(options);
  worlds.push(world);
  await initLibrary(world);
  return world;
};

const ingestDry = (world: World, extra: string[] = [], source = 'DCIM') =>
  runIn(world, [
    'ingest',
    join(world.srcRoot, source),
    '--dest',
    world.library,
    '--dry-run',
    ...extra,
  ]);

type Row = Record<string, unknown>;
const rows = (
  world: World,
  sql: string,
  ...params: (string | number)[]
): Row[] => {
  const ledger = openWorldLedger(world);
  try {
    return ledger.db.query(sql).all(...params) as Row[];
  } finally {
    ledger.close();
  }
};
/** コピー予定(`PLAN_COPY` のイベント)。`onlyLastRun` なら、最後の実行の分だけ */
const plannedPaths = (
  world: World,
  onlyLastRun = false
): Record<string, string> => {
  const out: Record<string, string> = {};
  const sql = onlyLastRun
    ? "SELECT message FROM events WHERE code = 'PLAN_COPY' AND run_id = (SELECT max(run_id) FROM runs)"
    : "SELECT message FROM events WHERE code = 'PLAN_COPY'";
  for (const row of rows(world, sql)) {
    const [from, to] = String(row.message).split(' → ');
    if (from && to) out[from] = to;
  }
  return out;
};
const stateOf = (world: World, relPath: string): Row | undefined =>
  rows(
    world,
    'SELECT state, ignore_reason FROM source_files WHERE rel_path = ?',
    relPath
  )[0];
const listAll = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true }).map(String).sort()
    : [];
const text = (result: { stdout: string[] }): string => result.stdout.join('\n');

describe('ingest --dry-run: 基本', () => {
  test('日付ごとの置き場所と名前を決める。保存先には、何も書かない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/100/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/100/b.jpg', {
      DateTimeOriginal: '2023:12:31 23:59:59',
    });
    await addPhoto(world, 'DCIM/200/IMG_20240305_102030.jpg');
    await addPhoto(world, 'DCIM/200/IMG_0004.jpg');
    const destBefore = listAll(world.destDrive);

    const result = await ingestDry(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stderr).toEqual([]);

    const planned = plannedPaths(world);
    expect(planned['DCIM/100/a.jpg']).toBe('2024/03/2024.03.05_10-20-30_a.jpg');
    expect(planned['DCIM/100/b.jpg']).toBe('2023/12/2023.12.31_23-59-59_b.jpg');
    expect(planned['DCIM/200/IMG_20240305_102030.jpg']).toMatch(
      /^2024\/03\/2024\.03\.05_10-20-30_/
    );
    expect(planned['DCIM/200/IMG_0004.jpg']).toBe(
      '_unknown/日付なし/IMG_0004.jpg'
    );

    // 保存先(ライブラリを含む)に、何も増えない
    expect(listAll(world.destDrive)).toEqual(destBefore);
    expect(text(result)).toMatch(/コピー予定[^\n]*: 4 ファイル/);
    expect(text(result)).toMatch(
      /日付フォールバック[^\n]*: 1 ファイル \(json 0 \/ ファイル名 1\)/
    );
    expect(text(result)).toMatch(/日付なし・不正[^\n]*: 1 ファイル/);
    expect(text(result)).toContain('[dry-run]');
  });

  test('台帳: 実行は dry-run、ファイルは planned、メタデータ・ハッシュのキャッシュ・イベントが残る', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      ...DATE_2024_03_05,
      Make: 'TestMake',
    });
    await addPhoto(world, 'DCIM/b.jpg', DATE_2024_03_05);
    await ingestDry(world);

    expect(
      rows(world, 'SELECT is_dry_run, status, revision_after FROM runs')
    ).toEqual([{ is_dry_run: 1, status: 'completed', revision_after: 1 }]);
    expect(
      rows(
        world,
        'SELECT state, count(*) AS n FROM source_files GROUP BY state'
      )
    ).toEqual([{ state: 'planned', n: 2 }]);
    expect(rows(world, 'SELECT count(*) AS n FROM hash_cache')).toEqual([
      { n: 2 },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM contents')).toEqual([
      { n: 2 },
    ]);
    expect(
      rows(
        world,
        'SELECT camera_make, date_precision, date_source FROM media_metadata WHERE camera_make IS NOT NULL'
      )
    ).toEqual([
      { camera_make: 'TestMake', date_precision: 'full', date_source: 'exif' },
    ]);
    expect(
      rows(
        world,
        "SELECT code FROM events WHERE code IN ('RUN_START', 'RUN_END') ORDER BY event_id"
      ).map((r) => r.code)
    ).toEqual(['RUN_START', 'RUN_END']);
    // ライブラリのファイルは、作らない(dry-run)
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')).toEqual([
      { n: 0 },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM file_groups')).toEqual([
      { n: 0 },
    ]);
  });

  test('2 回目は、ハッシュをキャッシュから得る。--rehash は、計算し直す', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/b.jpg', DATE_2024_03_05);
    expect(text(await ingestDry(world))).toMatch(
      /ハッシュ[^\n]*: 計算 2 \/ キャッシュ 0/
    );
    expect(text(await ingestDry(world))).toMatch(
      /ハッシュ[^\n]*: 計算 0 \/ キャッシュ 2/
    );
    expect(text(await ingestDry(world, ['--rehash']))).toMatch(
      /ハッシュ[^\n]*: 計算 2 \/ キャッシュ 0/
    );
  });

  test('写真と動画の、同じ語幹のペア(ライブフォトなど)は、同じ日時の名前でそろう', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/IMG_0001.JPG', DATE_2024_03_05);
    addVideo(world, 'DCIM/IMG_0001.MOV');
    await ingestDry(world);
    const planned = plannedPaths(world);
    expect(planned['DCIM/IMG_0001.JPG']).toBe(
      '2024/03/2024.03.05_10-20-30_IMG_0001.jpg'
    );
    expect(planned['DCIM/IMG_0001.MOV']).toBe(
      '2024/03/2024.03.05_10-20-30_IMG_0001.mov'
    );
    expect(
      rows(
        world,
        'SELECT count(DISTINCT date_precision) AS n FROM media_metadata'
      )
    ).toEqual([{ n: 1 }]);
  });

  test('動画だけの日付(UTC)は、本機のタイムゾーン(東京)に直す', async () => {
    const world = await newWorld();
    addVideo(world, 'DCIM/MOV_0001.mp4');
    await ingestDry(world);
    // UTC 2024-03-05 01:02:03 → 東京 10:02:03
    expect(plannedPaths(world)['DCIM/MOV_0001.mp4']).toBe(
      '2024/03/2024.03.05_10-02-03_MOV_0001.mp4'
    );
  });

  test('Takeout の json から、日付を決める(フォールバック json)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/takeout.jpg');
    addFile(
      world,
      'DCIM/takeout.jpg.json',
      JSON.stringify({ photoTakenTime: { timestamp: '1709600523' } })
    );
    const result = await ingestDry(world);
    // 1709600523 = 2024-03-05T01:02:03Z → 東京 10:02:03
    expect(plannedPaths(world)['DCIM/takeout.jpg']).toBe(
      '2024/03/2024.03.05_10-02-03_takeout.jpg'
    );
    expect(text(result)).toMatch(
      /日付フォールバック[^\n]*: 1 ファイル \(json 1 \/ ファイル名 0\)/
    );
    expect(text(result)).toMatch(/Takeout の json 1/);
  });
});

describe('ingest --dry-run: グループの日付の記録', () => {
  test('日付のない動画は、同じ語幹の写真の日付が、名前にも台帳(日付・取得元)にも使われる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/IMG_0001.JPG', DATE_2024_03_05);
    addVideo(world, 'DCIM/IMG_0001.MOV', 'nodate.mp4');
    await ingestDry(world);
    const planned = plannedPaths(world);
    expect(planned['DCIM/IMG_0001.MOV']).toBe(
      '2024/03/2024.03.05_10-20-30_IMG_0001.mov'
    );
    // 動画のメタデータにも、グループの日付(写真の EXIF)が入る(動画自身は、日付が不正だった)
    expect(
      rows(
        world,
        `SELECT s.rel_path, m.taken_at, m.date_precision, m.date_source
         FROM source_files s JOIN media_metadata m ON m.content_id = s.content_id ORDER BY s.rel_path`
      )
    ).toEqual([
      {
        rel_path: 'DCIM/IMG_0001.JPG',
        taken_at: '2024-03-05T10:20:30',
        date_precision: 'full',
        date_source: 'exif',
      },
      {
        rel_path: 'DCIM/IMG_0001.MOV',
        taken_at: '2024-03-05T10:20:30',
        date_precision: 'full',
        date_source: 'exif',
      },
    ]);
  });

  test('重複(グループの外)のファイルは、採用側のメタデータを、上書きしない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    // 同じ内容で、日付のないファイル名(同じ内容なので、同じ日付のはず。ここでは、順序の確認)
    await addPhoto(world, 'DCIM/b.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    await ingestDry(world);
    expect(rows(world, 'SELECT count(*) AS n FROM media_metadata')).toEqual([
      { n: 1 },
    ]);
    expect(rows(world, 'SELECT date_source FROM media_metadata')).toEqual([
      { date_source: 'exif' },
    ]);
  });

  test('参考の更新日は、そのファイル自身のもの', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/IMG_0001.JPG', DATE_2024_03_05);
    addVideo(world, 'DCIM/IMG_0001.MOV', 'nodate.mp4');
    await ingestDry(world);
    // どちらの更新日も 2000-01-01(テストでそろえた値)
    expect(
      rows(world, 'SELECT DISTINCT mtime_ref_ms FROM media_metadata')
    ).toEqual([{ mtime_ref_ms: 946_684_800_000 }]);
  });
});

describe('ingest --dry-run: 重複', () => {
  test('この実行の中で、同じ内容が複数あれば、先の 1 件だけを採用する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    await addPhoto(world, 'DCIM/b.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    await addPhoto(world, 'DCIM/c.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    const result = await ingestDry(world);
    expect(Object.keys(plannedPaths(world))).toEqual(['DCIM/a.jpg']);
    expect(stateOf(world, 'DCIM/b.jpg')).toEqual({
      state: 'duplicate',
      ignore_reason: '採用予定: DCIM/a.jpg',
    });
    expect(stateOf(world, 'DCIM/c.jpg')?.state).toBe('duplicate');
    expect(text(result)).toMatch(
      /重複スキップ[^\n]*: 2 ファイル \(ライブラリに既存 0 \/ 今回の中 2\)/
    );
    expect(text(result)).toMatch(/コピー予定[^\n]*: 1 ファイル/);
  });

  test('ライブラリにすでにある内容は、重複(採用側との対応を記録する)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingestDry(world); // 内容とハッシュのキャッシュを作る

    // 前の実行で、その内容を、ライブラリにコピー済みだったことにする
    const ledger = openWorldLedger(world);
    const content = ledger.db
      .query('SELECT content_id FROM contents')
      .get() as { content_id: number };
    const volume = upsertVolume(ledger.db, { volumeUuid: 'prev', seenAt: NOW });
    const prevRun = startRun(ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const adopted = insertLibraryFile(ledger.db, {
      contentId: content.content_id,
      groupId: insertFileGroup(ledger.db, { stem: 'a', bucket: 'full' }),
      runId: prevRun,
      relPath: '2024/03/2024.03.05_10-20-30_a.jpg',
      bucket: 'full',
      createdAt: NOW,
    });
    ledger.close();

    const result = await ingestDry(world);
    expect(plannedPaths(world, true)).toEqual({});
    const second = rows(
      world,
      'SELECT source_file_id, state FROM source_files WHERE run_id = (SELECT max(run_id) FROM runs)'
    );
    expect(second).toEqual([
      { source_file_id: expect.any(Number), state: 'duplicate' },
    ]);
    const check = openWorldLedger(world);
    expect(
      findDuplicateLinkBySource(check.db, Number(second[0]?.source_file_id))
        ?.adoptedLibraryFileId
    ).toBe(adopted);
    check.close();
    expect(text(result)).toMatch(
      /重複スキップ[^\n]*: 1 ファイル \(ライブラリに既存 1 \/ 今回の中 0\)/
    );
  });

  test('名前の衝突: 保存先に実在する・台帳にあるファイルと同じ名前なら、連番を取り直す', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    // 保存先に、同じ名前の別のファイル(大文字小文字だけ違う)が、すでにある
    mkdirSync(join(world.library, '2024/03'), { recursive: true });
    writeFileSync(
      join(world.library, '2024/03/2024.03.05_10-20-30_A.JPG'),
      'someone else'
    );
    const result = await ingestDry(world);
    expect(plannedPaths(world)['DCIM/a.jpg']).toBe(
      '2024/03/2024.03.05_10-20-30_a_01.jpg'
    );
    expect(text(result)).toMatch(/連番を付けた[^\n]*: 1 グループ/);
  });

  test('同じ日時・同じ名前で、内容が違う 2 つは、連番で別の名前になる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/100/IMG_1.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/200/IMG_1.jpg', DATE_2024_03_05);
    await ingestDry(world);
    const names = Object.values(plannedPaths(world)).sort();
    expect(names).toEqual([
      '2024/03/2024.03.05_10-20-30_IMG_1.jpg',
      '2024/03/2024.03.05_10-20-30_IMG_1_01.jpg',
    ]);
  });
});

describe('ingest --dry-run: エラー・対象外', () => {
  test('空ファイルは EMPTY_FILE。終了コードは 1(完了したが、エラーあり)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/ok.jpg', DATE_2024_03_05);
    addFile(world, 'DCIM/empty.jpg', '');
    const result = await ingestDry(world);
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(
      rows(world, "SELECT code FROM errors WHERE code = 'EMPTY_FILE'")
    ).toHaveLength(1);
    expect(stateOf(world, 'DCIM/empty.jpg')?.state).toBe('error');
    expect(text(result)).toMatch(/エラー[^\n]*: 1 ファイル \(EMPTY_FILE 1\)/);
  });

  test('メタデータを読めないもの(全部ゼロ)は、破損にしない。普通のファイルと同じ流れで、日付は、ファイル名などで決める', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/IMG_20240305_102030.jpg', new Uint8Array(64));
    addFile(world, 'DCIM/broken.jpg', new Uint8Array(65));
    const result = await ingestDry(world);
    const planned = plannedPaths(world);
    // ファイル名の日付で決まる / 決まらなければ、日付なし(読み取り不可には、置かない)
    expect(planned['DCIM/IMG_20240305_102030.jpg']).toMatch(
      /^2024\/03\/2024\.03\.05_10-20-30_/
    );
    expect(planned['DCIM/broken.jpg']).toBe('_unknown/日付なし/broken.jpg');
    // エラー一覧には載せない。警告のイベントだけ
    expect(rows(world, 'SELECT count(*) AS n FROM errors')).toEqual([{ n: 0 }]);
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM events WHERE code = 'META_UNREADABLE' AND level = 'WARN'"
      )
    ).toEqual([{ n: 2 }]);
    expect(stateOf(world, 'DCIM/broken.jpg')?.state).toBe('planned');
    expect(text(result)).toMatch(/メタデータなし[^\n]*: 2 ファイル/);
    expect(text(result)).not.toContain('CORRUPTED');
    expect(result.code).toBe(EXIT_CODES.ok);
    // 日付の取得元は、ファイル名として、台帳に残る(メタデータの行は、作る)
    expect(
      rows(
        world,
        'SELECT date_source FROM media_metadata ORDER BY date_source'
      ).map((r) => r.date_source)
    ).toEqual(['filename', 'none']);
  });

  test('メタデータが読めなくても、Takeout の json があれば、日付に使う', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/t.jpg', new Uint8Array(64));
    addFile(
      world,
      'DCIM/t.jpg.json',
      JSON.stringify({ photoTakenTime: { timestamp: '1709600523' } })
    );
    await ingestDry(world);
    expect(plannedPaths(world)['DCIM/t.jpg']).toBe(
      '2024/03/2024.03.05_10-02-03_t.jpg'
    );
  });

  test('読めないバイト(権限なし)は READ_FAILED。コピーの予定にしない', async () => {
    const world = await newWorld();
    const path = addFile(world, 'DCIM/locked.jpg', 'x');
    const { chmodSync } = await import('node:fs');
    chmodSync(path, 0o000);
    try {
      const result = await ingestDry(world);
      expect(stateOf(world, 'DCIM/locked.jpg')?.state).toBe('error');
      expect(plannedPaths(world)).toEqual({});
      expect(
        rows(world, "SELECT code FROM errors WHERE code = 'READ_FAILED'").length
      ).toBeGreaterThan(0);
      expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  test('対象外(.aae)・ZIP・管理用ファイル・RAW のない .xmp は、件数だけ(台帳に行を作らない)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    addFile(world, 'DCIM/a.aae', 'x');
    addFile(world, 'DCIM/photos.zip', 'PK');
    addFile(world, 'DCIM/.DS_Store', 'x');
    addFile(world, 'DCIM/._a.jpg', 'x');
    addFile(world, 'DCIM/lonely.xmp', '<x/>');
    const result = await ingestDry(world);
    expect(text(result)).toMatch(
      /対象外 1 \/ Takeout の json 0 \/ ZIP\(未対応\) 1 \/ 除外 2 \/ RAW のない \.xmp 1/
    );
    expect(
      rows(world, 'SELECT rel_path FROM source_files ORDER BY rel_path').map(
        (r) => r.rel_path
      )
    ).toEqual(['DCIM/a.jpg', 'DCIM/lonely.xmp']);
    expect(stateOf(world, 'DCIM/lonely.xmp')?.state).toBe('ignored');
    expect(plannedPaths(world)).toEqual({
      'DCIM/a.jpg': '2024/03/2024.03.05_10-20-30_a.jpg',
    });
  });

  test('前の実行で処理済み(done)のファイルは、スキップする(件数だけ。行は作らない)', async () => {
    const world = await newWorld();
    const path = await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/b.jpg', DATE_2024_03_05);
    const { statSync } = await import('node:fs');
    const stats = statSync(path);

    const ledger = openWorldLedger(world);
    const volume = upsertVolume(ledger.db, {
      volumeUuid: world.sourceVolume.volumeUuid,
      seenAt: NOW,
    });
    const prevRun = startRun(ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: NOW,
    });
    const id = insertSourceFile(ledger.db, {
      runId: prevRun,
      volumeId: volume.volumeId,
      relPath: 'DCIM/a.jpg',
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      kind: 'photo',
      ext: 'jpg',
    });
    setSourceFileState(ledger.db, id, 'done');
    ledger.close();

    const result = await ingestDry(world);
    expect(text(result)).toMatch(/処理済み[^\n]*: 1 ファイル/);
    expect(Object.keys(plannedPaths(world))).toEqual(['DCIM/b.jpg']);
    expect(
      rows(
        world,
        'SELECT count(*) AS n FROM source_files WHERE run_id = (SELECT max(run_id) FROM runs)'
      )
    ).toEqual([{ n: 1 }]);
  });

  test('複数のソースは、1 つずつ、別の実行として処理する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'A/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'B/b.jpg', {
      DateTimeOriginal: '2022:01:02 03:04:05',
    });
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'A'),
      join(world.srcRoot, 'B'),
      '--dest',
      world.library,
      '--dry-run',
    ]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(rows(world, 'SELECT count(*) AS n FROM runs')).toEqual([{ n: 2 }]);
    expect(Object.values(plannedPaths(world)).sort()).toEqual([
      '2022/01/2022.01.02_03-04-05_b.jpg',
      '2024/03/2024.03.05_10-20-30_a.jpg',
    ]);
    expect(
      rows(world, 'SELECT revision_after FROM runs ORDER BY run_id').map(
        (r) => r.revision_after
      )
    ).toEqual([1, 2]);
  });
});

describe('ingest: 準備と保存先の検査', () => {
  test('--dry-run と --resume は、一緒に使えない(2)', async () => {
    const world = await newWorld();
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--dry-run',
      '--resume',
    ]);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('--resume');
  });

  test('引数が足りなければ、使い方を出して 2', async () => {
    const world = await newWorld();
    expect((await runIn(world, ['ingest', '--dest', world.library])).code).toBe(
      EXIT_CODES.failed
    );
    expect(
      (await runIn(world, ['ingest', join(world.srcRoot, 'DCIM')])).code
    ).toBe(EXIT_CODES.failed);
  });

  test('保存先に目印がなく、端末でなければ、library init を案内して 2(何も作らない)', async () => {
    const world = await newWorld();
    mkdirSync(join(world.destDrive, 'Plain'));
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      join(world.destDrive, 'Plain'),
      '--dry-run',
    ]);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('library init');
    expect(readdirSync(join(world.destDrive, 'Plain'))).toEqual([]);
  });

  test('保存先に目印がなく、端末なら、作るか質問する: はい → 作って続ける / いいえ → 中止(2)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const plain = join(world.destDrive, 'Plain');
    mkdirSync(plain);
    const questions: string[] = [];
    const yes = await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', plain, '--dry-run'],
      {
        isInteractive: true,
        newLibraryId: () => 'lib-2',
        confirm: async (question) => {
          questions.push(question);
          return true;
        },
      }
    );
    expect(yes.code).toBe(EXIT_CODES.ok);
    expect(questions).toEqual(['ここに、ライブラリを作りますか']);
    expect(existsSync(join(plain, '.file-seiri-library.json'))).toBe(true);
    expect(text(yes)).toContain('ライブラリを作りました');
    expect(text(yes)).toMatch(/コピー予定[^\n]*: 1 ファイル/);

    const other = join(world.destDrive, 'Other');
    mkdirSync(other);
    const no = await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', other, '--dry-run'],
      {
        isInteractive: true,
        confirm: async () => false,
      }
    );
    expect(no.code).toBe(EXIT_CODES.failed);
    expect(no.stderr.join('\n')).toContain('中止');
    expect(readdirSync(other)).toEqual([]);
  });

  test('使えないドライブ(NTFS)には、質問せず、ライブラリも作らない', async () => {
    const world = await newWorld({ destVolume: { fsType: 'ntfs' } });
    const plain = join(world.destDrive, 'Plain');
    mkdirSync(plain);
    let asked = false;
    const result = await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', plain, '--dry-run'],
      {
        isInteractive: true,
        confirm: async () => {
          asked = true;
          return true;
        },
      }
    );
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('DEST_FORMAT_UNSUPPORTED');
    expect(asked).toBe(false);
    expect(readdirSync(plain)).toEqual([]);
  });

  test('ソースのフォルダがなければ 2。ソースと保存先が同じボリュームなら 2', async () => {
    const world = await newWorld();
    const missing = await ingestDry(world, [], 'NONE');
    expect(missing.code).toBe(EXIT_CODES.failed);
    expect(missing.stderr.join('\n')).toContain('ソースのフォルダがありません');

    mkdirSync(join(world.srcRoot, 'DCIM'), { recursive: true });
    const same = await ingestDry({ ...world, sourceVolume: world.destVolume });
    expect(same.code).toBe(EXIT_CODES.failed);
    expect(same.stderr.join('\n')).toContain('同じボリューム');
  });

  test('保存先が NTFS・読み取り専用なら、スキャンの前に止める(2)', async () => {
    for (const [overrides, code] of [
      [{ fsType: 'ntfs' }, 'DEST_FORMAT_UNSUPPORTED'],
      [{ isWritable: false }, 'DEST_NOT_WRITABLE'],
    ] as const) {
      const world = await newWorld({ destVolume: overrides });
      mkdirSync(join(world.srcRoot, 'DCIM'), { recursive: true });
      const result = await ingestDry(world);
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(result.stderr.join('\n')).toContain(code);
      expect(rows(world, 'SELECT count(*) AS n FROM runs')).toEqual([{ n: 0 }]);
    }
  });

  test('容量が足りなければ、不足分を表示して 2(dry-run の結果は、記録する)', async () => {
    const world = await newWorld({ destVolume: { freeBytes: 1000 } });
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const result = await ingestDry(world);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(text(result)).toContain('CAPACITY_SHORTAGE');
    expect(text(result)).toMatch(/足りません/);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'completed' },
    ]);
  });

  test('容量が足りていれば、必要量(余裕分を含む)と「足りています」を表示する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const result = await ingestDry(world);
    expect(text(result)).toMatch(/必要な容量[^\n]*余裕分 10\.0 GB を含む/);
    expect(text(result)).toMatch(/保存先の空き[^\n]*足りています/);
  });

  test('途中で予期しない失敗が起きたら、実行は failed として残り、エラーは伝わる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    // 台帳への記録で、失敗させる(ソースのファイルの記録を、拒否するトリガー)
    const ledger = openWorldLedger(world);
    ledger.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON source_files BEGIN SELECT RAISE(ABORT, 'boom'); END"
    );
    ledger.close();
    await expect(ingestDry(world)).rejects.toThrow('boom');
    expect(rows(world, 'SELECT is_dry_run, status FROM runs')).toEqual([
      { is_dry_run: 1, status: 'failed' },
    ]);
  });
});

describe('ingest: スナップショットとの比較(起動時)', () => {
  /** スナップショットだけが、リビジョン 3(作業用の台帳は 1)の状態を作る */
  const makeSnapshotNewer = (world: World): string => {
    const ledger = openWorldLedger(world);
    while (getRevision(ledger.db) < 3) incrementRevision(ledger.db);
    const snapshotPath = join(
      world.library,
      '.file-seiri',
      'catalog.snapshot.sqlite'
    );
    createSnapshot(ledger, snapshotPath);
    ledger.db.query("UPDATE meta SET value = '1' WHERE key = 'revision'").run();
    ledger.close();
    return snapshotPath;
  };

  test('スナップショットのほうが新しく、端末でなければ、停止する(2)。何も書き換えない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    makeSnapshotNewer(world);
    const result = await ingestDry(world);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('--restore-snapshot');
    expect(
      rows(world, "SELECT value FROM meta WHERE key = 'revision'")
    ).toEqual([{ value: '1' }]);
    expect(rows(world, 'SELECT count(*) AS n FROM runs')).toEqual([{ n: 0 }]);
  });

  test('--restore-snapshot で、置き換えて続ける(前の台帳は、別名で残す)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    makeSnapshotNewer(world);
    const result = await ingestDry(world, ['--restore-snapshot']);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('スナップショットで置き換えました');
    // 復元したリビジョン 3 のあとに、この実行の分(+1)
    expect(
      rows(world, "SELECT value FROM meta WHERE key = 'revision'")
    ).toEqual([{ value: '4' }]);
    expect(
      readdirSync(join(world.dataDir, 'libraries', 'lib-1')).some((name) =>
        name.includes('.replaced-')
      )
    ).toBe(true);
  });

  test('端末なら質問する: はい → 置き換えて続ける / いいえ → 中止(2)', async () => {
    const yes = await newWorld();
    await addPhoto(yes, 'DCIM/a.jpg', DATE_2024_03_05);
    makeSnapshotNewer(yes);
    const questions: string[] = [];
    const accepted = await runIn(
      yes,
      ['ingest', join(yes.srcRoot, 'DCIM'), '--dest', yes.library, '--dry-run'],
      {
        isInteractive: true,
        confirm: async (question) => {
          questions.push(question);
          return true;
        },
      }
    );
    expect(accepted.code).toBe(EXIT_CODES.ok);
    expect(questions).toHaveLength(1);

    const no = await newWorld();
    await addPhoto(no, 'DCIM/a.jpg', DATE_2024_03_05);
    makeSnapshotNewer(no);
    const refused = await runIn(
      no,
      ['ingest', join(no.srcRoot, 'DCIM'), '--dest', no.library, '--dry-run'],
      {
        isInteractive: true,
        confirm: async () => false,
      }
    );
    expect(refused.code).toBe(EXIT_CODES.failed);
    expect(refused.stderr.join('\n')).toContain('中止');
    expect(rows(no, "SELECT value FROM meta WHERE key = 'revision'")).toEqual([
      { value: '1' },
    ]);
  });

  test('作業用の台帳がなく、スナップショットがあれば、確認なしで復元する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    makeSnapshotNewer(world);
    const { rmSync } = await import('node:fs');
    rmSync(join(world.dataDir, 'libraries'), { recursive: true });
    const result = await ingestDry(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('スナップショットから復元しました');
  });

  test('ライブラリを別の場所へ移したときは、設定の場所を更新する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const moved = join(world.destDrive, 'Moved');
    const { renameSync } = await import('node:fs');
    renameSync(world.library, moved);
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      moved,
      '--dry-run',
    ]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('ライブラリの場所を更新しました');
  });
});
