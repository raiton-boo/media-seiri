import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addFile,
  addPhoto,
  initLibrary,
  makeWorld,
  NOW,
  openWorldLedger,
  runIn,
  useExifWriter,
  type World,
} from '../ingest/test-support.ts';

useExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

const newLibrary = async (): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  return world;
};

/** 写真 2 枚 + メタデータの読めないファイル(WARN のイベントが出る)を、取り込む(本実行) */
const ingested = async (): Promise<World> => {
  const world = await newLibrary();
  await addPhoto(world, 'DCIM/a.jpg', {
    DateTimeOriginal: '2024:03:05 10:20:30',
  });
  await addPhoto(world, 'DCIM/b.jpg', {
    DateTimeOriginal: '2023:12:31 23:59:59',
  });
  addFile(world, 'DCIM/c.jpg', new Uint8Array(64)); // 全部ゼロ: メタデータを読めない(WARN)
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

const logs = (
  world: World,
  extra: string[] = [],
  options: Parameters<typeof runIn>[2] = {}
) => runIn(world, ['logs', ...extra], options);
const codes = (lines: string[]): string[] =>
  lines.map((line) => /#\d+ (\S+)/.exec(line)?.[1] ?? '');

describe('logs: 表示と絞り込み', () => {
  test('既定: 直近の実行の、INFO 以上を、古い順に表示する(DEBUG は、出さない)', async () => {
    const world = await ingested();
    const result = await logs(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stderr).toEqual([]);
    const lines = result.stdout;
    expect(lines[0]).toMatch(/^2026-10-18 09:00:00 INFO {2}#1 RUN_START /);
    expect(lines.at(-1)).toMatch(/^2026-10-18 09:00:00 INFO {2}#1 RUN_END /);
    expect(codes(lines)).toContain('COPIED');
    expect(codes(lines)).toContain('PLAN_COPY');
    expect(codes(lines)).not.toContain('COPY_START');
    // すべての行が、同じ形(時刻 レベル #実行 コード メッセージ)
    for (const line of lines)
      expect(line).toMatch(
        /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (DEBUG|INFO |WARN |ERROR) #1 [A-Z_]+ /
      );
  });

  test('--verbose で DEBUG(COPY_START)も、--quiet・--level WARN で、WARN 以上だけ', async () => {
    const world = await ingested();
    expect(codes((await logs(world, ['--verbose'])).stdout)).toContain(
      'COPY_START'
    );
    for (const extra of [
      ['--quiet'],
      ['--level', 'WARN'],
      ['--level', 'warn'],
    ]) {
      const lines = (await logs(world, extra)).stdout;
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => /^\S+ \S+ (WARN |ERROR) /.test(line))).toBe(
        true
      );
      expect(codes(lines)).toContain('META_UNREADABLE');
    }
    const errors = (await logs(world, ['--level', 'ERROR'])).stdout;
    expect(errors.every((line) => / ERROR /.test(line))).toBe(true);
  });

  test('--level が正しくない・--level と --verbose などの併用は、2', async () => {
    const world = await ingested();
    for (const extra of [
      ['--level', 'LOUD'],
      ['--verbose', '--quiet'],
      ['--level', 'INFO', '--verbose'],
    ]) {
      const result = await logs(world, extra);
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(result.stderr.join('\n')).toMatch(/--level|どれか 1 つ/);
    }
  });

  test('--run で、指定した実行。ない実行・不正な値は、2', async () => {
    const world = await ingested();
    // 2 つ目の実行(dry-run)を作る
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--dry-run',
    ]);
    expect(codes((await logs(world)).stdout).includes('RUN_START')).toBe(true);
    expect((await logs(world)).stdout[0]).toContain('#2 ');
    expect((await logs(world, ['--run', '1'])).stdout[0]).toContain('#1 ');
    const missing = await logs(world, ['--run', '99']);
    expect(missing.code).toBe(EXIT_CODES.failed);
    expect(missing.stderr.join('\n')).toContain('実行 99 が見つかりません');
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect((await logs(world, ['--run', bad])).code).toBe(EXIT_CODES.failed);
    }
  });

  test('--tail で、最後の N 行だけ。不正な値は 2', async () => {
    const world = await ingested();
    const all = (await logs(world)).stdout;
    const tail = (await logs(world, ['--tail', '3'])).stdout;
    expect(tail).toEqual(all.slice(-3));
    expect((await logs(world, ['--tail', '1000'])).stdout).toEqual(all);
    for (const bad of ['0', 'x', '-2'])
      expect((await logs(world, ['--tail', bad])).code).toBe(EXIT_CODES.failed);
  });

  test('時刻は、本機のタイムゾーンで表示する。色は、useColor のときだけ(INFO 以外)', async () => {
    const world = await ingested();
    expect((await logs(world)).stdout[0]).toContain('2026-10-18 09:00:00');
    expect((await logs(world, [], { timeZone: 'UTC' })).stdout[0]).toContain(
      '2026-10-18 00:00:00'
    );
    expect((await logs(world, ['--quiet'])).stdout.join('\n')).not.toContain(
      '\u001b'
    );
    expect(
      (await logs(world, ['--quiet'], { useColor: true })).stdout.join('\n')
    ).toContain('\u001b[33m');
  });
});

describe('logs: 準備', () => {
  test('実行の記録がなければ、その旨を表示する(0)', async () => {
    const world = await newLibrary();
    const result = await logs(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout).toEqual(['実行の記録がありません。']);
  });

  test('登録がない・この Mac に台帳がないときは、案内して 2', async () => {
    const empty = makeWorld();
    worlds.push(empty);
    const none = await logs(empty);
    expect(none.code).toBe(EXIT_CODES.failed);
    expect(none.stderr.join('\n')).toContain(
      '登録されたライブラリがありません'
    );

    const world = await newLibrary();
    const { rmSync } = await import('node:fs');
    rmSync(join(world.dataDir, 'libraries'), { recursive: true });
    const noLedger = await logs(world);
    expect(noLedger.code).toBe(EXIT_CODES.failed);
    expect(noLedger.stderr.join('\n')).toContain('台帳がありません');
  });

  test('読み取り専用: 台帳を書き換えない。別の実行が、ロックを持っていても、読める', async () => {
    const world = await ingested();
    const ledger = openWorldLedger(world);
    ledger.db
      .query(
        "INSERT OR REPLACE INTO locks (lock_name, holder, acquired_at, heartbeat_at) VALUES ('ingest', 'busy', ?, ?)"
      )
      .run(NOW.toISOString(), NOW.toISOString());
    const before = (
      ledger.db
        .query("SELECT value FROM meta WHERE key = 'revision'")
        .get() as { value: string }
    ).value;
    ledger.close();
    const result = await logs(world);
    expect(result.code).toBe(EXIT_CODES.ok);
    const check = openWorldLedger(world);
    expect(
      (
        check.db
          .query("SELECT value FROM meta WHERE key = 'revision'")
          .get() as { value: string }
      ).value
    ).toBe(before);
    expect(
      (check.db.query('SELECT count(*) AS n FROM runs').get() as { n: number })
        .n
    ).toBe(1);
    check.close();
  });

  test('ライブラリのドライブが抜けていても(この Mac の設定に登録があれば)、ログは見られる', async () => {
    const world = await ingested();
    const moved = join(world.destDrive, 'Elsewhere');
    renameSync(world.library, moved); // ドライブが、抜けた想定: 登録された場所に、ライブラリがない
    const result = await runIn(world, ['logs', '--library', world.library]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

describe('logs --follow(追いかけ)', () => {
  /** 実行中のまま止まっている、本実行を作る(イベントを、あとから足せる) */
  const runningRun = async () => {
    const world = await newLibrary();
    const ledger = openWorldLedger(world);
    ledger.db
      .query(
        "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES ('v', '2026-10-18T00:00:00Z')"
      )
      .run();
    ledger.db
      .query(
        "INSERT INTO runs (source_volume_id, is_dry_run, status, started_at) VALUES (1, 0, 'running', '2026-10-18T00:00:00Z')"
      )
      .run();
    ledger.close();
    const add = (level: string, code: string, message: string): void => {
      const db = openWorldLedger(world);
      db.db
        .query(
          "INSERT INTO events (run_id, level, code, message, occurred_at) VALUES (1, ?, ?, ?, '2026-10-18T00:00:00.000Z')"
        )
        .run(level, code, message);
      db.close();
    };
    const finish = (): void => {
      const db = openWorldLedger(world);
      db.db
        .query(
          "UPDATE runs SET status = 'completed', finished_at = '2026-10-18T00:01:00Z' WHERE run_id = 1"
        )
        .run();
      db.close();
    };
    return { world, add, finish };
  };

  test('終わった実行は、表示して、すぐ終了する(待たない)', async () => {
    const world = await ingested();
    let slept = 0;
    const result = await logs(world, ['--follow'], {
      sleep: async () => {
        slept += 1;
      },
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(slept).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test('実行中は、新しいイベントを追いかけて表示し、実行が終わったら、最後の分まで表示して終了する', async () => {
    const { world, add, finish } = await runningRun();
    add('INFO', 'FIRST', 'first');
    let round = 0;
    const result = await logs(world, ['--follow'], {
      sleep: async () => {
        round += 1;
        if (round === 1) add('INFO', 'SECOND', 'second');
        if (round === 2) {
          add('INFO', 'THIRD', 'third');
          finish();
        }
      },
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(codes(result.stdout)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(round).toBe(2);
  });

  test('追いかけでも、レベルで絞る。DEBUG は、出さない', async () => {
    const { world, add, finish } = await runningRun();
    add('DEBUG', 'HIDDEN_AT_START', 'x');
    let round = 0;
    const result = await logs(world, ['--follow'], {
      sleep: async () => {
        round += 1;
        add('DEBUG', 'HIDDEN_LATER', 'y');
        add('WARN', 'SHOWN', 'z');
        finish();
      },
    });
    expect(codes(result.stdout)).toEqual(['SHOWN']);
    expect(round).toBe(1);
  });

  test('Ctrl-C(中断の要求)で、実行中のままでも、追いかけをやめる(0)', async () => {
    const { world, add } = await runningRun();
    add('INFO', 'ONLY', 'only');
    let stop = false;
    let rounds = 0;
    const result = await logs(world, ['--follow'], {
      shouldStop: () => stop,
      sleep: async () => {
        rounds += 1;
        stop = true;
      },
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(codes(result.stdout)).toEqual(['ONLY']);
    expect(rounds).toBe(1);
  });
});

describe('ログのファイル保存', () => {
  const logPath = (world: World, runId: number): string =>
    join(world.dataDir, 'libraries', 'lib-1', 'logs', `run-${runId}.log`);

  test('取り込み・dry-run・検査のどれでも、実行ごとに 1 ファイル。DEBUG も含む。画面の制御文字は、含まない', async () => {
    const world = await ingested();
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--dry-run',
    ]);
    await runIn(world, ['verify', '--library', world.library]);
    for (const runId of [1, 2, 3])
      expect(existsSync(logPath(world, runId))).toBe(true);

    const ingestLog = readFileSync(logPath(world, 1), 'utf8');
    expect(ingestLog).toContain(' COPY_START ');
    expect(ingestLog).toContain(' RUN_END ');
    expect(ingestLog).not.toContain('\u001b');
    // ファイルの内容は、台帳のイベントと同じ数
    const ledger = openWorldLedger(world);
    const count = (
      ledger.db
        .query('SELECT count(*) AS n FROM events WHERE run_id = 1')
        .get() as { n: number }
    ).n;
    ledger.close();
    expect(ingestLog.trimEnd().split('\n')).toHaveLength(count);
    expect(readFileSync(logPath(world, 3), 'utf8')).toContain('VERIFY_RESULT');
  });

  test('中断して再開した実行は、全体(前の分も含む)を書き直す', async () => {
    const world = await newLibrary();
    for (let index = 1; index <= 4; index += 1)
      await addPhoto(world, `DCIM/p${index}.jpg`, {
        DateTimeOriginal: `2024:03:0${index} 10:00:00`,
      });
    let stop = false;
    await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, '--yes'],
      {
        shouldStop: () => stop,
        ingestHooks: {
          afterFileCopied: (copied) => {
            if (copied === 1) stop = true;
          },
        },
      }
    );
    const interrupted = readFileSync(logPath(world, 1), 'utf8')
      .trimEnd()
      .split('\n');
    expect(interrupted.at(-1)).toContain('(interrupted)');
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--resume',
      '--yes',
    ]);
    const resumed = readFileSync(logPath(world, 1), 'utf8')
      .trimEnd()
      .split('\n');
    expect(resumed.length).toBeGreaterThan(interrupted.length);
    expect(resumed.slice(0, interrupted.length - 1)).toEqual(
      interrupted.slice(0, -1)
    );
    expect(resumed.at(-1)).toContain('(completed)');
    expect(resumed.some((line) => line.includes(' RUN_RESUME '))).toBe(true);
  });

  test('ログファイルを書けなくても、実行は成功する(警告だけ)', async () => {
    const world = await newLibrary();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    // logs を、ファイルにして、フォルダを作れないようにする
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(world.dataDir, 'libraries', 'lib-1'), { recursive: true });
    writeFileSync(
      join(world.dataDir, 'libraries', 'lib-1', 'logs'),
      'not a directory'
    );
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stderr.join('\n')).toContain(
      'ログファイルを書き出せませんでした'
    );
  });
});
