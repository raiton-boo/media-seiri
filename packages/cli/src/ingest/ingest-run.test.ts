import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { EXIT_CODES } from '../exit-codes.ts';
import { encodeCopyIntent, parseCopyIntent } from './copy-events.ts';
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

type RunOptions = Parameters<typeof runIn>[2];
const ingest = (
  world: World,
  extra: string[] = [],
  runOptions: RunOptions = {},
  source = 'DCIM'
) =>
  runIn(
    world,
    ['ingest', join(world.srcRoot, source), '--dest', world.library, ...extra],
    runOptions
  );

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
const text = (result: { stdout: string[] }): string => result.stdout.join('\n');

/** ライブラリの中の、写真などのファイル(管理用の `.file-seiri` と、目印を除く) */
const libraryFiles = (world: World): string[] =>
  readdirSync(world.library, { recursive: true })
    .map(String)
    .filter(
      (name) =>
        !name.startsWith('.file-seiri') && name !== '.file-seiri-library.json'
    )
    .filter((name) => statSync(join(world.library, name)).isFile())
    .sort();

/** ソースの、全ファイルの名前・サイズ・更新日(変わっていないことの確認) */
const sourceFingerprint = (world: World): string[] =>
  readdirSync(world.srcRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stats = statSync(path);
      return `${path}|${stats.size}|${stats.mtimeMs}`;
    })
    .sort();

const A = '2024/03/2024.03.05_10-20-30_a.jpg';
const B = '2023/12/2023.12.31_23-59-59_b.jpg';

/** 日付つきの写真を、n 枚、置く(名前は p1.jpg…。日付は、日ごとに違う) */
const addPhotos = async (world: World, count: number): Promise<void> => {
  for (let index = 1; index <= count; index += 1) {
    await addPhoto(world, `DCIM/p${index}.jpg`, {
      DateTimeOriginal: `2024:03:0${index} 10:00:00`,
    });
  }
};

describe('ingest(本実行): コピーと記録', () => {
  test('コピーして、台帳に記録し、スナップショットを作る。ソースは変えない', async () => {
    const world = await newWorld();
    const a = await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const b = await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2023:12:31 23:59:59',
    });
    await addPhoto(world, 'DCIM/c.jpg'); // 日付なし
    const before = sourceFingerprint(world);

    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stderr).toEqual([]);
    expect(libraryFiles(world)).toEqual(
      [B, '_unknown/日付なし/c.jpg', A].sort()
    );

    // 中身が、ソースと同じ。更新日は、引き継がない(コピーした時刻)
    expect(readFileSync(join(world.library, A)).equals(readFileSync(a))).toBe(
      true
    );
    expect(readFileSync(join(world.library, B)).equals(readFileSync(b))).toBe(
      true
    );
    expect(statSync(join(world.library, A)).mtimeMs).toBeGreaterThan(
      946_684_800_000 + 86_400_000
    );
    // ソースは、変わらない
    expect(sourceFingerprint(world)).toEqual(before);
    // 一時ファイル・付属ファイルは、残らない
    expect(
      libraryFiles(world).filter(
        (name) => name.includes('.part') || name.includes('/._')
      )
    ).toEqual([]);

    expect(text(result)).toMatch(/コピー済み[^\n]*: 3 ファイル/);
    expect(text(result)).toMatch(/コピー失敗[^\n]*: 0 ファイル/);
  });

  test('台帳: 実行は本実行で completed、ファイルは done、ライブラリのファイル・グループ・メタデータ・イベント', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      ...DATE_2024_03_05,
      Make: 'TestMake',
    });
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2023:12:31 23:59:59',
    });
    await ingest(world);

    expect(
      rows(world, 'SELECT is_dry_run, status, revision_after FROM runs')
    ).toEqual([{ is_dry_run: 0, status: 'completed', revision_after: 1 }]);
    expect(
      rows(
        world,
        'SELECT state, count(*) AS n FROM source_files GROUP BY state'
      )
    ).toEqual([{ state: 'done', n: 2 }]);
    expect(
      rows(
        world,
        'SELECT rel_path, bucket, is_repaired FROM library_files ORDER BY rel_path'
      )
    ).toEqual([
      { rel_path: B, bucket: 'full', is_repaired: 0 },
      { rel_path: A, bucket: 'full', is_repaired: 0 },
    ]);
    expect(
      rows(world, 'SELECT stem, bucket FROM file_groups ORDER BY stem')
    ).toEqual([
      { stem: 'a', bucket: 'full' },
      { stem: 'b', bucket: 'full' },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM media_metadata')).toEqual([
      { n: 2 },
    ]);
    expect(
      rows(
        world,
        "SELECT code FROM events WHERE code IN ('COPY_START', 'COPIED') ORDER BY event_id"
      ).map((r) => r.code)
    ).toEqual(['COPY_START', 'COPIED', 'COPY_START', 'COPIED']);
    // ロックは、解放されている
    expect(rows(world, 'SELECT count(*) AS n FROM locks')).toEqual([{ n: 0 }]);
  });

  test('スナップショット(.file-seiri/catalog.snapshot.sqlite)は、WAL でなく、台帳と同じリビジョンで、ロックを含まない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    const snapshotPath = join(
      world.library,
      '.file-seiri',
      'catalog.snapshot.sqlite'
    );
    expect(existsSync(snapshotPath)).toBe(true);
    expect(readdirSync(join(world.library, '.file-seiri')).sort()).toEqual([
      'catalog.snapshot.sqlite',
    ]);
    const snapshot = openLedger(snapshotPath, { mode: 'readonly' });
    try {
      expect(
        (
          snapshot.db
            .query("SELECT value FROM meta WHERE key = 'revision'")
            .get() as { value: string }
        ).value
      ).toBe('1');
      expect(
        (
          snapshot.db
            .query('SELECT count(*) AS n FROM library_files')
            .get() as { n: number }
        ).n
      ).toBe(1);
      expect(
        (
          snapshot.db.query('SELECT count(*) AS n FROM locks').get() as {
            n: number;
          }
        ).n
      ).toBe(0);
      expect(
        (
          snapshot.db.query('PRAGMA journal_mode').get() as {
            journal_mode: string;
          }
        ).journal_mode
      ).toBe('delete');
    } finally {
      snapshot.close();
    }
  });

  test('2 回目の実行は、処理済みをスキップして、二重にコピーしない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    const second = await ingest(world);
    expect(second.code).toBe(EXIT_CODES.ok);
    expect(text(second)).toMatch(/処理済み[^\n]*: 1 ファイル/);
    expect(text(second)).toMatch(/コピー済み[^\n]*: 0 ファイル/);
    expect(libraryFiles(world)).toEqual([A]);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')).toEqual([
      { n: 1 },
    ]);
  });

  test('ソースに、あとから足したファイルだけが、追加でコピーされる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2023:12:31 23:59:59',
    });
    const second = await ingest(world);
    expect(text(second)).toMatch(/コピー済み[^\n]*: 1 ファイル/);
    expect(libraryFiles(world)).toEqual([B, A]);
    expect(rows(world, 'SELECT count(*) AS n FROM runs')).toEqual([{ n: 2 }]);
  });

  test('写真と動画のペアは、同じ日時の名前で並んでコピーされる(1 つのグループ)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/IMG_0001.JPG', DATE_2024_03_05);
    addVideo(world, 'DCIM/IMG_0001.MOV', 'nodate.mp4');
    await ingest(world);
    expect(libraryFiles(world)).toEqual([
      '2024/03/2024.03.05_10-20-30_IMG_0001.jpg',
      '2024/03/2024.03.05_10-20-30_IMG_0001.mov',
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM file_groups')).toEqual([
      { n: 1 },
    ]);
    expect(
      rows(world, 'SELECT DISTINCT group_id FROM library_files')
    ).toHaveLength(1);
  });

  test('空ファイルは、コピーせず EMPTY_FILE。終了コードは 1', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    addFile(world, 'DCIM/empty.jpg', '');
    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(libraryFiles(world)).toEqual([A]);
    expect(
      rows(world, "SELECT count(*) AS n FROM errors WHERE code = 'EMPTY_FILE'")
    ).toEqual([{ n: 1 }]);
  });

  test('メタデータを読めないファイルも、普通にコピーされる(破損にしない)', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/IMG_20240305_102030.jpg', new Uint8Array(64));
    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(libraryFiles(world)).toEqual([
      '2024/03/2024.03.05_10-20-30_IMG_20240305_102030.jpg',
    ]);
  });
});

describe('ingest(本実行): 重複と名前の衝突', () => {
  test('今回の中の重複は、コピーせず、採用側に結びつける(duplicate_links)', async () => {
    const world = await newWorld();
    for (const name of ['a', 'b', 'c'])
      await addPhoto(world, `DCIM/${name}.jpg`, {
        ...DATE_2024_03_05,
        ImageDescription: 'same',
      });
    const result = await ingest(world);
    expect(libraryFiles(world)).toEqual([A]);
    expect(
      rows(
        world,
        'SELECT state, count(*) AS n FROM source_files GROUP BY state ORDER BY state'
      )
    ).toEqual([
      { state: 'done', n: 1 },
      { state: 'duplicate', n: 2 },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')).toEqual([
      { n: 2 },
    ]);
    expect(
      rows(
        world,
        'SELECT DISTINCT adopted_library_file_id AS id FROM duplicate_links'
      ).length
    ).toBe(1);
    expect(text(result)).toMatch(/重複の記録[^\n]*: 2 ファイル/);
  });

  test('前の実行でコピー済みの内容は、重複として、コピーしない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'A/a.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    await ingest(world, [], {}, 'A');
    await addPhoto(world, 'B/copy.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'same',
    });
    const second = await ingest(world, [], {}, 'B');
    expect(text(second)).toMatch(
      /重複スキップ[^\n]*: 1 ファイル \(ライブラリに既存 1/
    );
    expect(libraryFiles(world)).toEqual([A]);
    expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')).toEqual([
      { n: 1 },
    ]);
  });

  test('保存先に、同じ名前の別のファイルがあれば、上書きせず、連番で別の名前になる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    mkdirSync(join(world.library, '2024/03'), { recursive: true });
    writeFileSync(join(world.library, A), 'someone else');
    await ingest(world);
    expect(readFileSync(join(world.library, A), 'utf8')).toBe('someone else');
    expect(libraryFiles(world)).toEqual([
      A,
      '2024/03/2024.03.05_10-20-30_a_01.jpg',
    ]);
  });
});

describe('ingest(本実行): 失敗', () => {
  test('書けない場所のファイルは COPY_FAILED。ほかは続ける。終了コード 1。直して再実行すると、取り込める', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/z-copy.jpg', {
      ...DATE_2024_03_05,
      ImageDescription: 'DCIM/a.jpg',
    }); // a と同じ内容
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2023:12:31 23:59:59',
    });
    mkdirSync(join(world.library, '2024/03'), { recursive: true });
    chmodSync(join(world.library, '2024/03'), 0o555);
    try {
      const result = await ingest(world);
      expect(result.code).toBe(EXIT_CODES.completedWithErrors);
      expect(libraryFiles(world)).toEqual([B]);
      expect(
        rows(
          world,
          "SELECT code FROM errors WHERE code = 'COPY_FAILED' ORDER BY error_id"
        ).length
      ).toBeGreaterThanOrEqual(2);
      // 採用側(a)の失敗で、重複(a-copy)も、取り込めていない(error。duplicate にしない)
      expect(
        rows(
          world,
          "SELECT rel_path, state FROM source_files WHERE rel_path IN ('DCIM/a.jpg', 'DCIM/z-copy.jpg') ORDER BY rel_path"
        )
      ).toEqual([
        { rel_path: 'DCIM/a.jpg', state: 'error' },
        { rel_path: 'DCIM/z-copy.jpg', state: 'error' },
      ]);
      expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')).toEqual([
        { n: 0 },
      ]);
      expect(
        libraryFiles(world).filter((name) => name.includes('.part'))
      ).toEqual([]);
      expect(text(result)).toMatch(/コピー失敗[^\n]*: 2 ファイル/);
    } finally {
      chmodSync(join(world.library, '2024/03'), 0o755);
    }
    // 直したあとの再実行で、エラーだったものが、取り込まれる(処理済みに、数えない)
    const retry = await ingest(world);
    expect(retry.code).toBe(EXIT_CODES.ok);
    expect(libraryFiles(world)).toEqual([B, A]);
    expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')).toEqual([
      { n: 1 },
    ]);
  });

  test('保存先の問題(容量不足)があれば、コピーせずに止める(2)。実行は failed', async () => {
    const world = await newWorld({ destVolume: { freeBytes: 1000 } });
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(text(result)).toContain('CAPACITY_SHORTAGE');
    expect(libraryFiles(world)).toEqual([]);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'failed' },
    ]);
  });

  test('起動時に、前の実行が残した一時ファイルを消す', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    mkdirSync(join(world.library, '2024/03'), { recursive: true });
    writeFileSync(join(world.library, '2024/03/.old.jpg.part'), 'leftover');
    const result = await ingest(world);
    expect(existsSync(join(world.library, '2024/03/.old.jpg.part'))).toBe(
      false
    );
    expect(text(result)).toContain('一時ファイルを、1 件、削除しました');
  });
});

describe('ingest(本実行): ロック', () => {
  const setLock = (world: World, holder: string, heartbeatAt: Date): void => {
    const ledger = openWorldLedger(world);
    ledger.db
      .query(
        "INSERT OR REPLACE INTO locks (lock_name, holder, acquired_at, heartbeat_at) VALUES ('ingest', ?, ?, ?)"
      )
      .run(holder, heartbeatAt.toISOString(), heartbeatAt.toISOString());
    ledger.close();
  };

  test('別の実行が、生きたままロックを持っていれば、保持者を表示して、すぐ終了(2)。何も書かない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    setLock(world, 'other-holder', NOW);
    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('other-holder');
    expect(libraryFiles(world)).toEqual([]);
    expect(rows(world, 'SELECT count(*) AS n FROM runs')).toEqual([{ n: 0 }]);
    expect(rows(world, 'SELECT holder FROM locks')).toEqual([
      { holder: 'other-holder' },
    ]);
  });

  test('60 秒以上途絶えたロックは、自動で引き継ぎ、前の実行を中断として記録する', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    // 前の実行が、実行中のまま、異常終了した
    const ledger = openWorldLedger(world);
    ledger.db
      .query(
        "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES ('prev', '2026-10-17T00:00:00Z')"
      )
      .run();
    ledger.db
      .query(
        "INSERT INTO runs (source_volume_id, is_dry_run, status, started_at) VALUES (1, 0, 'running', '2026-10-17T00:00:00Z')"
      )
      .run();
    ledger.close();
    setLock(world, 'dead-holder', new Date(NOW.getTime() - 61_000));

    const result = await ingest(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('引き継ぎました');
    expect(
      rows(world, 'SELECT run_id, status FROM runs ORDER BY run_id')
    ).toEqual([
      { run_id: 1, status: 'interrupted' },
      { run_id: 2, status: 'completed' },
    ]);
    expect(
      rows(world, "SELECT level FROM events WHERE code = 'LOCK_TAKEOVER'")
    ).toEqual([{ level: 'WARN' }]);
    expect(libraryFiles(world)).toEqual([A]);
  });

  test('59 秒のロックは、引き継げない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    setLock(world, 'slow-holder', new Date(NOW.getTime() - 59_000));
    expect((await ingest(world)).code).toBe(EXIT_CODES.failed);
  });

  test('dry-run は、ロックを取らない(別の実行が書き込み中でも、結果を見られる)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    setLock(world, 'other-holder', NOW);
    expect((await ingest(world, ['--dry-run'])).code).toBe(EXIT_CODES.ok);
    expect(rows(world, 'SELECT holder FROM locks')).toEqual([
      { holder: 'other-holder' },
    ]);
  });

  test('実行中にロックを失ったら(別の実行に引き継がれた)、それ以上、書き込まずに、安全に止まる', async () => {
    const world = await newWorld();
    await addPhotos(world, 4);
    const result = await ingest(world, [], {
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied !== 1) return;
          // スリープから復帰した、という想定: ロックが、別の実行に取られた
          const thief = openWorldLedger(world);
          thief.db
            .query(
              "UPDATE locks SET holder = 'thief' WHERE lock_name = 'ingest'"
            )
            .run();
          thief.close();
        },
      },
    });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(text(result)).toContain('ロックを失った');
    // 1 つ目だけ、コピーして、記録した。2 つ目以降は、コピーも、記録もしない
    expect(libraryFiles(world)).toHaveLength(1);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')).toEqual([
      { n: 1 },
    ]);
    // 新しい保持者のロックは、消さない。この実行は、台帳に終了を書かない
    expect(rows(world, 'SELECT holder FROM locks')).toEqual([
      { holder: 'thief' },
    ]);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'running' },
    ]);
    expect(
      libraryFiles(world).filter((name) => name.includes('.part'))
    ).toEqual([]);
  });
});

describe('ingest(本実行): 中断と再開', () => {
  test('Ctrl-C(中断の要求)で、今のファイルまで終えて止まる。interrupted・130。スナップショットも作る', async () => {
    const world = await newWorld();
    await addPhotos(world, 5);
    let stop = false;
    const result = await ingest(world, [], {
      shouldStop: () => stop,
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 2) stop = true;
        },
      },
    });
    expect(result.code).toBe(EXIT_CODES.interrupted);
    expect(text(result)).toContain('--resume');
    expect(libraryFiles(world)).toHaveLength(2);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'interrupted' },
    ]);
    expect(
      rows(
        world,
        'SELECT state, count(*) AS n FROM source_files GROUP BY state ORDER BY state'
      )
    ).toEqual([
      { state: 'done', n: 2 },
      { state: 'planned', n: 3 },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM locks')).toEqual([{ n: 0 }]);
    expect(
      existsSync(join(world.library, '.file-seiri', 'catalog.snapshot.sqlite'))
    ).toBe(true);
  });

  test('--resume で、同じ実行の続きから、残りだけをコピーする(二重にコピーしない)', async () => {
    const world = await newWorld();
    await addPhotos(world, 5);
    let stop = false;
    await ingest(world, [], {
      shouldStop: () => stop,
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 2) stop = true;
        },
      },
    });
    const first = libraryFiles(world);

    const resumed = await ingest(world, ['--resume']);
    expect(resumed.code).toBe(EXIT_CODES.ok);
    expect(text(resumed)).toMatch(/完了済み[^\n]*: 2 ファイル/);
    expect(text(resumed)).toMatch(/コピー済み[^\n]*: 3 ファイル/);
    expect(libraryFiles(world)).toHaveLength(5);
    expect(first.every((name) => libraryFiles(world).includes(name))).toBe(
      true
    );
    // 同じ実行 ID を続けた
    expect(rows(world, 'SELECT run_id, status FROM runs')).toEqual([
      { run_id: 1, status: 'completed' },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')).toEqual([
      { n: 5 },
    ]);
    expect(
      rows(
        world,
        'SELECT state, count(*) AS n FROM source_files GROUP BY state'
      )
    ).toEqual([{ state: 'done', n: 5 }]);
  });

  test('--resume なしで、中断した実行があるときは、注意を表示して、新しい実行として続ける(処理済みは、コピーしない)', async () => {
    const world = await newWorld();
    await addPhotos(world, 4);
    let stop = false;
    await ingest(world, [], {
      shouldStop: () => stop,
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 1) stop = true;
        },
      },
    });
    const second = await ingest(world);
    expect(text(second)).toContain('中断した実行があります');
    expect(libraryFiles(world)).toHaveLength(4);
    expect(
      rows(world, 'SELECT run_id, status FROM runs ORDER BY run_id')
    ).toEqual([
      { run_id: 1, status: 'interrupted' },
      { run_id: 2, status: 'completed' },
    ]);
  });

  test('再開できる実行がなければ、2', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    const result = await ingest(world, ['--resume']);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('再開できる実行がありません');
  });

  test('記録の前に止まったコピー(保存先にファイルだけがある)は、再開のとき、ハッシュが一致すれば採用する(_01 で重ねない)', async () => {
    const world = await newWorld();
    await addPhotos(world, 3);
    let stop = false;
    await ingest(world, [], {
      shouldStop: () => stop,
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 2) stop = true;
        },
      },
    });
    // 異常終了の再現: 2 つ目のコピーは、保存先にできたが、台帳に記録される前に止まった
    const ledger = openWorldLedger(world);
    const last = ledger.db
      .query(
        'SELECT library_file_id AS id, rel_path FROM library_files ORDER BY library_file_id DESC LIMIT 1'
      )
      .get() as {
      id: number;
      rel_path: string;
    };
    ledger.db
      .query('DELETE FROM library_files WHERE library_file_id = ?')
      .run(last.id);
    ledger.db
      .query(
        "UPDATE source_files SET state = 'planned' WHERE state = 'done' AND content_id = (SELECT content_id FROM source_files WHERE state = 'done' ORDER BY source_file_id DESC LIMIT 1)"
      )
      .run();
    ledger.close();

    const resumed = await ingest(world, ['--resume']);
    expect(resumed.code).toBe(EXIT_CODES.ok);
    expect(text(resumed)).toContain('1 件、採用しました');
    expect(libraryFiles(world)).toHaveLength(3);
    expect(libraryFiles(world).some((name) => /_01\./.test(name))).toBe(false);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')).toEqual([
      { n: 3 },
    ]);
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM events WHERE code = 'COPY_RECOVERED'"
      )
    ).toEqual([{ n: 1 }]);
    expect(
      rows(world, "SELECT count(*) AS n FROM source_files WHERE state = 'done'")
    ).toEqual([{ n: 3 }]);
  });

  test('保存先のファイルが、意図したハッシュと違うときは、採用しない(別のファイルかもしれない)', async () => {
    const world = await newWorld();
    await addPhotos(world, 2);
    let stop = false;
    await ingest(world, [], {
      shouldStop: () => stop,
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 1) stop = true;
        },
      },
    });
    const ledger = openWorldLedger(world);
    const first = ledger.db
      .query('SELECT library_file_id AS id, rel_path FROM library_files')
      .get() as { id: number; rel_path: string };
    ledger.db
      .query('DELETE FROM library_files WHERE library_file_id = ?')
      .run(first.id);
    ledger.close();
    writeFileSync(
      join(world.library, first.rel_path),
      'tampered but same size?'
    );

    const resumed = await ingest(world, ['--resume']);
    expect(text(resumed)).not.toContain('採用しました');
    // 上書きせず、連番で別の名前になる
    expect(readFileSync(join(world.library, first.rel_path), 'utf8')).toBe(
      'tampered but same size?'
    );
  });

  test('ドライブが抜けた(ソースがなくなった)ら、エラーを重ねず、中断する(2)。再開できる', async () => {
    const world = await newWorld();
    await addPhotos(world, 4);
    const result = await ingest(world, [], {
      ingestHooks: {
        afterFileCopied: (copied) => {
          if (copied === 1)
            rmSync(join(world.srcRoot, 'DCIM'), { recursive: true });
        },
      },
    });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(text(result)).toContain('ドライブが抜けた');
    expect(libraryFiles(world)).toHaveLength(1);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'interrupted' },
    ]);
    // エラーは、1 件だけ(あとのファイルを、次々に失敗させない)
    expect(rows(world, 'SELECT count(*) AS n FROM errors')).toEqual([{ n: 1 }]);
  });
});

describe('ingest(本実行): 実行前の確認', () => {
  test('端末で、--yes がなければ、質問する。いいえ → コピーせず、中断(130)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    const questions: string[] = [];
    const result = await ingest(world, [], {
      isInteractive: true,
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });
    expect(result.code).toBe(EXIT_CODES.interrupted);
    expect(questions).toEqual(['この内容で、コピーを始めますか']);
    expect(libraryFiles(world)).toEqual([]);
    expect(rows(world, 'SELECT status FROM runs')).toEqual([
      { status: 'interrupted' },
    ]);
    // 続きから実行できる(--resume)
    const resumed = await ingest(world, ['--resume', '--yes'], {
      isInteractive: true,
    });
    expect(resumed.code).toBe(EXIT_CODES.ok);
    expect(libraryFiles(world)).toEqual([A]);
  });

  test('はい → コピーする。--yes があれば、質問しない。端末でなければ、質問しない', async () => {
    const yes = await newWorld();
    await addPhoto(yes, 'DCIM/a.jpg', DATE_2024_03_05);
    expect(
      (
        await ingest(yes, [], {
          isInteractive: true,
          confirm: async () => true,
        })
      ).code
    ).toBe(EXIT_CODES.ok);
    expect(libraryFiles(yes)).toEqual([A]);

    const flag = await newWorld();
    await addPhoto(flag, 'DCIM/a.jpg', DATE_2024_03_05);
    let asked = false;
    await ingest(flag, ['--yes'], {
      isInteractive: true,
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(libraryFiles(flag)).toEqual([A]);
  });
});

describe('copy-events', () => {
  test('コピーの意図を、符号化して、読み戻せる。形が違うものは、undefined', () => {
    const intent = {
      src: 'DCIM/a.jpg',
      dest: A,
      hash: 'f'.repeat(64),
      sizeBytes: 10,
      stem: 'a',
      bucket: 'full' as const,
    };
    expect(parseCopyIntent(encodeCopyIntent(intent))).toEqual(intent);
    for (const bad of [
      '',
      'not json',
      '[]',
      'null',
      '{"src":1}',
      JSON.stringify({ ...intent, sizeBytes: '10' }),
    ]) {
      expect(parseCopyIntent(bad)).toBeUndefined();
    }
  });
});
