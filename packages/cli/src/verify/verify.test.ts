import { afterEach, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  NOW,
  openWorldLedger,
  runIn,
  type World,
} from '../ingest/test-support.ts';

installExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

/** ライブラリを作り、写真を n 枚、取り込む(本実行) */
const newLibrary = async (
  count = 3,
  options?: Parameters<typeof makeWorld>[0]
): Promise<World> => {
  const world = makeWorld(options);
  worlds.push(world);
  await initLibrary(world);
  for (let index = 1; index <= count; index += 1) {
    await addPhoto(world, `DCIM/p${index}.jpg`, {
      DateTimeOriginal: `2024:03:0${index} 10:00:00`,
    });
  }
  const result = await runIn(world, [
    'ingest',
    join(world.srcRoot, 'DCIM'),
    '--dest',
    world.library,
    '--yes',
  ]);
  if (result.code !== 0)
    throw new Error(`取り込めない: ${result.stderr.join('\n')}`);
  return world;
};

const verify = (
  world: World,
  extra: string[] = [],
  options: Parameters<typeof runIn>[2] = {}
) => runIn(world, ['verify', '--library', world.library, ...extra], options);

type Row = Record<string, unknown>;
const rows = (world: World, sql: string): Row[] => {
  const ledger = openWorldLedger(world);
  try {
    return ledger.db.query(sql).all() as Row[];
  } finally {
    ledger.close();
  }
};
const text = (result: { stdout: string[] }): string => result.stdout.join('\n');
const P1 = '2024/03/2024.03.01_10-00-00_p1.jpg';
const P2 = '2024/03/2024.03.02_10-00-00_p2.jpg';
const P3 = '2024/03/2024.03.03_10-00-00_p3.jpg';

describe('verify', () => {
  test('すべて一致なら 0。結果を表示し、検査の実行を記録する(リビジョン +1・スナップショット更新)', async () => {
    const world = await newLibrary(3);
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toMatch(/台帳のファイル: 3 件/);
    expect(text(result)).toMatch(/一致: 3 件/);
    expect(text(result)).toMatch(/不一致: 0 件/);
    expect(text(result)).toMatch(/欠落: 0 件/);
    expect(text(result)).toMatch(/未登録: 0 件/);
    expect(text(result)).toMatch(/読んだ量: /);

    expect(
      rows(
        world,
        'SELECT run_id, kind, status, is_dry_run, revision_after FROM runs ORDER BY run_id'
      )
    ).toEqual([
      {
        run_id: 1,
        kind: 'ingest',
        status: 'completed',
        is_dry_run: 0,
        revision_after: 1,
      },
      {
        run_id: 2,
        kind: 'verify',
        status: 'completed',
        is_dry_run: 0,
        revision_after: 2,
      },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM errors')).toEqual([{ n: 0 }]);
    expect(
      rows(world, "SELECT message FROM events WHERE code = 'VERIFY_RESULT'")
    ).toEqual([
      {
        message:
          '検査 3 件: 一致 3・不一致 0・欠落 0・読み取り不可 0・未登録 0',
      },
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM locks')).toEqual([{ n: 0 }]);
    const snapshot = openLedger(
      join(world.library, '.file-seiri', 'catalog.snapshot.sqlite'),
      { mode: 'readonly' }
    );
    expect(
      (
        snapshot.db
          .query("SELECT value FROM meta WHERE key = 'revision'")
          .get() as { value: string }
      ).value
    ).toBe('2');
    snapshot.close();
  });

  test('同じサイズで、内容が変わった(ビットが化けた)ファイルは、不一致。エラー一覧に VERIFY_MISMATCH。終了コード 1', async () => {
    const world = await newLibrary(3);
    const path = join(world.library, P2);
    const bytes = readFileSync(path);
    bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0xff;
    writeFileSync(path, bytes);

    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(text(result)).toMatch(/一致: 2 件/);
    expect(text(result)).toMatch(/不一致: 1 件/);
    expect(text(result)).toContain(`${P2}: ハッシュが違います`);
    const errors = rows(world, 'SELECT code, detail FROM errors');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('VERIFY_MISMATCH');
    expect(String(errors[0]?.detail)).toContain(P2);
    // 検査は、ファイルを直さない・消さない(化けたまま)
    expect(readFileSync(path).equals(bytes)).toBe(true);
  });

  test('サイズが変わった(途中で切れた・追記された)ファイルは、不一致(サイズ)', async () => {
    const world = await newLibrary(2);
    appendFileSync(join(world.library, P1), 'extra');
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(text(result)).toMatch(/サイズが違います/);
  });

  test('ファイルがなければ、欠落(VERIFY_MISMATCH)。終了コード 1', async () => {
    const world = await newLibrary(3);
    rmSync(join(world.library, P3));
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(text(result)).toMatch(/欠落: 1 件/);
    expect(text(result)).toContain(`${P3}: ファイルがありません`);
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM errors WHERE code = 'VERIFY_MISMATCH'"
      )
    ).toEqual([{ n: 1 }]);
  });

  test('台帳にないファイルは、未登録(報告のみ。終了コードは 0)。付属ファイル・一時ファイルなどは、数えない', async () => {
    const world = await newLibrary(2);
    writeFileSync(join(world.library, '2024/03/stray.jpg'), 'someone put this');
    writeFileSync(join(world.library, '2024/03/._p1.jpg'), 'x');
    writeFileSync(join(world.library, '2024/03/.p1.jpg.part'), 'x');
    writeFileSync(join(world.library, '.DS_Store'), 'x');
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toMatch(/未登録: 1 件/);
    expect(text(result)).toContain('2024/03/stray.jpg');
    expect(
      rows(
        world,
        "SELECT level, code FROM events WHERE code = 'VERIFY_UNREGISTERED'"
      )
    ).toEqual([{ level: 'WARN', code: 'VERIFY_UNREGISTERED' }]);
    expect(rows(world, 'SELECT count(*) AS n FROM errors')).toEqual([{ n: 0 }]);
    // 未登録のファイルには、触らない
    expect(readFileSync(join(world.library, '2024/03/stray.jpg'), 'utf8')).toBe(
      'someone put this'
    );
  });

  test('問題が多いときは、画面には 20 件まで。全件は、エラー一覧に記録する', async () => {
    const world = await newLibrary(1);
    // 台帳に、実在しないファイルを、25 件、足す(欠落)
    const ledger = openWorldLedger(world);
    const content = ledger.db
      .query('SELECT content_id FROM contents')
      .get() as { content_id: number };
    for (let index = 0; index < 25; index += 1) {
      const group = ledger.db
        .query("INSERT INTO file_groups (stem, bucket) VALUES ('g', 'full')")
        .run().lastInsertRowid;
      ledger.db
        .query(
          "INSERT INTO library_files (content_id, group_id, run_id, rel_path, bucket, created_at) VALUES (?, ?, 1, ?, 'full', '2026-10-18T00:00:00Z')"
        )
        .run(
          content.content_id,
          Number(group),
          `ghost/g${String(index).padStart(2, '0')}.jpg`
        );
    }
    ledger.close();
    const result = await verify(world);
    expect(text(result)).toMatch(/欠落: 25 件/);
    expect(text(result)).toContain('ほか 5 件');
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM errors WHERE code = 'VERIFY_MISMATCH'"
      )
    ).toEqual([{ n: 25 }]);
  });

  test('--sample: 抜き取りで検査する(件数を表示)', async () => {
    const world = await newLibrary(5);
    const result = await verify(world, ['--sample', '40%'], {
      random: () => 0,
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toMatch(/台帳のファイル: 5 件\(抜き取り 2 件を検査\)/);
    expect(text(result)).toMatch(/一致: 2 件/);
    expect(
      rows(
        world,
        "SELECT message FROM events WHERE code = 'RUN_START' AND run_id = 2"
      )[0]?.message
    ).toContain('抜き取り 40%');
  });

  test('--sample が正しくなければ 2(何も記録しない)', async () => {
    const world = await newLibrary(1);
    for (const bad of ['0', '150%', 'abc']) {
      const result = await verify(world, ['--sample', bad]);
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(result.stderr.join('\n')).toContain('--sample');
    }
    expect(
      rows(world, "SELECT count(*) AS n FROM runs WHERE kind = 'verify'")
    ).toEqual([{ n: 0 }]);
  });

  test('Ctrl-C で、そこで止まる(130)。ここまでの結果を記録し、実行は interrupted', async () => {
    const world = await newLibrary(5);
    let calls = 0;
    const result = await verify(world, [], {
      // 3 回目の確認で、中断の要求が来る(最初の 2 件を検査したあと)
      shouldStop: () => {
        calls += 1;
        return calls >= 3;
      },
    });
    expect(result.code).toBe(EXIT_CODES.interrupted);
    expect(text(result)).toContain('[中断]');
    expect(text(result)).toMatch(/未登録: \(中断したため、調べていません\)/);
    expect(
      rows(world, "SELECT status FROM runs WHERE kind = 'verify'")
    ).toEqual([{ status: 'interrupted' }]);
    expect(rows(world, 'SELECT count(*) AS n FROM locks')).toEqual([{ n: 0 }]);
  });
});

describe('verify: 表示', () => {
  test('台帳が空のときは、取り込んでいない可能性を案内する(速さの「0 B/秒」は出さない)', async () => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('台帳に、ライブラリのファイルがありません');
    expect(text(result)).not.toMatch(/\/秒/);
  });
});

describe('verify: ライブラリの指定と準備', () => {
  test('--library を省くと、この Mac に登録されたライブラリが 1 つなら、それを使う', async () => {
    const world = await newLibrary(1);
    const result = await runIn(world, ['verify']);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toMatch(/一致: 1 件/);
  });

  test('登録がない・複数ある・場所がない・目印がないときは、案内して 2', async () => {
    const empty = makeWorld();
    worlds.push(empty);
    const none = await runIn(empty, ['verify']);
    expect(none.code).toBe(EXIT_CODES.failed);
    expect(none.stderr.join('\n')).toContain(
      '登録されたライブラリがありません'
    );

    const world = await newLibrary(1);
    const other = join(world.destDrive, 'Second');
    mkdirSync(other);
    await runIn(world, ['library', 'init', other], {
      newLibraryId: () => 'lib-2',
    });
    const many = await runIn(world, ['verify']);
    expect(many.code).toBe(EXIT_CODES.failed);
    expect(many.stderr.join('\n')).toContain('ライブラリが複数あります');
    expect(many.stderr.join('\n')).toContain(other);

    const missing = await runIn(world, [
      'verify',
      '--library',
      join(world.destDrive, 'Gone'),
    ]);
    expect(missing.code).toBe(EXIT_CODES.failed);
    expect(missing.stderr.join('\n')).toContain('ライブラリが見つかりません');

    const plain = join(world.destDrive, 'Plain');
    mkdirSync(plain);
    let asked = false;
    const noMarker = await runIn(world, ['verify', '--library', plain], {
      isInteractive: true,
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    expect(noMarker.code).toBe(EXIT_CODES.failed);
    expect(noMarker.stderr.join('\n')).toContain('library init');
    // 検査では、ライブラリを新しく作る確認はしない
    expect(asked).toBe(false);
    expect(existsSync(join(plain, '.file-seiri-library.json'))).toBe(false);
  });

  test('別の実行が、ロックを持っていれば、保持者を表示して 2(検査もしない)', async () => {
    const world = await newLibrary(2);
    const ledger = openWorldLedger(world);
    ledger.db
      .query(
        "INSERT OR REPLACE INTO locks (lock_name, holder, acquired_at, heartbeat_at) VALUES ('ingest', 'busy-holder', ?, ?)"
      )
      .run(NOW.toISOString(), NOW.toISOString());
    ledger.close();
    const result = await verify(world);
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('busy-holder');
    expect(
      rows(world, "SELECT count(*) AS n FROM runs WHERE kind = 'verify'")
    ).toEqual([{ n: 0 }]);
  });

  test('ライブラリを別のドライブへ移した(場所が変わった)あとの検査: 新しい場所を、設定に記録する', async () => {
    const world = await newLibrary(2);
    const moved = join(world.destDrive, 'Moved');
    renameSync(world.library, moved);
    const result = await runIn(world, ['verify', '--library', moved]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toContain('ライブラリの場所を更新しました');
    expect(text(result)).toMatch(/一致: 2 件/);
  });

  test('検査のあとの取り込みは、検査の実行を、再開の対象にしない', async () => {
    const world = await newLibrary(1);
    await verify(world);
    const resume = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--resume',
    ]);
    expect(resume.code).toBe(EXIT_CODES.failed);
    expect(resume.stderr.join('\n')).toContain('再開できる実行がありません');
  });

  test('exFAT の保存先では、検査のあとの付属ファイル(スナップショットの ._)も掃除する', async () => {
    const world = await newLibrary(1, { destVolume: { fsType: 'exfat' } });
    // 取り込みのあとに、macOS が作った付属ファイルの再現
    writeFileSync(join(world.library, '._.file-seiri-library.json'), 'x');
    await verify(world);
    expect(existsSync(join(world.library, '._.file-seiri-library.json'))).toBe(
      false
    );
    expect(statSync(join(world.library, P1)).isFile()).toBe(true);
  });
});
