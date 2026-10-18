import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { ledgerPathFor } from '../config/paths.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  type World,
} from '../ingest/test-support.ts';
import { spotCheck, spotCheckCount } from '../verify/spot-check.ts';

installExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

const photoWorld = async (count = 2): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  for (let index = 0; index < count; index += 1) {
    await addPhoto(world, `DCIM/p${index}.jpg`, {
      DateTimeOriginal: `2024:03:05 10:20:${String(10 + index).padStart(2, '0')}`,
    });
  }
  return world;
};

const ingestArgs = (world: World): string[] => [
  'ingest',
  join(world.srcRoot, 'DCIM'),
  '--dest',
  world.library,
  '--yes',
];

describe('取り込み後の抜き取り照合', () => {
  test('抜き取る数: 2%(5〜100 件。少ないときは、全件)', () => {
    expect(spotCheckCount(0)).toBe(0);
    expect(spotCheckCount(3)).toBe(3);
    expect(spotCheckCount(100)).toBe(5);
    expect(spotCheckCount(1000)).toBe(20);
    expect(spotCheckCount(100_000)).toBe(100);
  });

  test('取り込みの結果に、照合の結果が出る。--no-spot-check なら、行わない', async () => {
    const world = await photoWorld(3);
    const first = await runIn(world, ingestArgs(world));
    expect(first.code).toBe(0);
    expect(first.stdout.join('\n')).toMatch(
      /抜き取り照合　*: 3 ファイルを読み直し → 一致 3/
    );

    const other = await photoWorld(2);
    const skipped = await runIn(other, [
      ...ingestArgs(other),
      '--no-spot-check',
    ]);
    expect(skipped.code).toBe(0);
    expect(skipped.stdout.join('\n')).not.toContain('抜き取り照合');
  });

  test('書き終えたあとに、ファイルが変わっていれば、不一致として、エラーにする', async () => {
    const world = await photoWorld(2);
    const result = await runIn(world, ingestArgs(world));
    expect(result.code).toBe(0);
    const ledger = openLedger(ledgerPathFor(world.dataDir, 'lib-1'), {
      mode: 'readonly',
      libraryId: 'lib-1',
    });
    try {
      const target = ledger.db
        .query<{ relPath: string }, []>(
          'SELECT rel_path AS relPath FROM library_files LIMIT 1'
        )
        .get();
      writeFileSync(join(world.library, target?.relPath ?? ''), 'x');
      const check = await spotCheck({
        db: ledger.db,
        libraryRoot: world.library,
        runId: 1,
        hashFile: async () => 'different',
        random: () => 0.5,
        shouldStop: () => false,
      });
      expect(check.checked).toBe(2);
      expect(check.problems.length).toBeGreaterThanOrEqual(1);
      expect(check.problems.some((p) => p.detail.includes('大きさ'))).toBe(
        true
      );
    } finally {
      ledger.close();
    }
  });
});

describe('取り込み元ごとの履歴', () => {
  test('2 回目の取り込みの結果に、前回の履歴が出る。seiri sources で、一覧を見られる', async () => {
    const world = await photoWorld(2);
    const first = await runIn(world, ingestArgs(world));
    expect(first.stdout.join('\n')).not.toContain('このソースの履歴');
    await addPhoto(world, 'DCIM/new.jpg', {
      DateTimeOriginal: '2024:04:01 09:00:00',
    });
    const second = await runIn(world, ingestArgs(world));
    expect(second.stdout.join('\n')).toMatch(
      /このソースの履歴　*: これまでに 1 回、2 ファイルを取り込み済み/
    );

    const sources = await runIn(world, ['sources']);
    expect(sources.code).toBe(0);
    const text = sources.stdout.join('\n');
    expect(text).toContain('取り込み回数');
    expect(text).toContain('2 回');
  });

  test('記録がなければ、そう伝える', async () => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    // 台帳はあるが、実行がない
    const result = await runIn(world, ['sources']);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain(
      'まだ、取り込みの記録が、ありません'
    );
  });
});

describe('seiri status --watch', () => {
  test('実行がなければ待機し、止められる。端末でなければ、変化だけを、1 行ずつ出す', async () => {
    const world = await photoWorld(1);
    let ticks = 0;
    const result = await runIn(
      world,
      ['status', '--watch', '--interval', '0.1'],
      {
        sleep: async () => {
          ticks += 1;
        },
        shouldStop: () => ticks >= 3,
      }
    );
    expect(result.code).toBe(0);
    const lines = result.stdout.filter((line) => line.includes('待機中'));
    // 同じ状態は、くり返さない
    expect(lines).toHaveLength(1);
  });

  test('--interval が不正なら、失敗(2)', async () => {
    const world = await photoWorld(1);
    const result = await runIn(world, ['status', '--watch', '--interval', '0']);
    expect(result.code).toBe(2);
  });
});

describe('seiri backup', () => {
  test('台帳と設定を、日時つきのフォルダへコピーし、スナップショットと突き合わせる。--list で一覧', async () => {
    const world = await photoWorld(2);
    await runIn(world, ingestArgs(world));
    const result = await runIn(world, ['backup']);
    expect(result.code).toBe(0);
    const text = result.stdout.join('\n');
    expect(text).toContain('バックアップを作りました');
    expect(text).toContain('同じ(最新)');

    const base = join(world.dataDir, 'backups');
    const [name] = readdirSync(base);
    expect(name).toMatch(/^backup-\d{8}T\d{6}Z$/);
    const folder = join(base, name ?? '');
    expect(existsSync(join(folder, 'config.json'))).toBe(true);
    expect(
      existsSync(join(folder, 'libraries', 'lib-1', 'catalog.sqlite'))
    ).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(folder, 'manifest.json'), 'utf8')
    ) as {
      libraries: { files: number; comparison: string }[];
    };
    expect(manifest.libraries[0]?.files).toBe(2);
    // バックアップの台帳は、開ける
    const copy = openLedger(
      join(folder, 'libraries', 'lib-1', 'catalog.sqlite'),
      {
        mode: 'readonly',
        libraryId: 'lib-1',
      }
    );
    copy.close();

    const list = await runIn(world, ['backup', '--list']);
    expect(list.stdout.join('\n')).toContain(name ?? '');
  });

  test('別の場所へも作れる。ライブラリのドライブには、何も書かない', async () => {
    const world = await photoWorld(1);
    await runIn(world, ingestArgs(world));
    const before = readdirSync(world.library).sort();
    const target = join(world.base, 'elsewhere');
    const result = await runIn(world, ['backup', '--to', target]);
    expect(result.code).toBe(0);
    expect(readdirSync(target).length).toBe(1);
    expect(readdirSync(world.library).sort()).toEqual(before);
  });
});

describe('seiri doctor --report', () => {
  test('JSON の報告を書き出す。既定では、パスを伏せる。--include-paths で含める', async () => {
    const world = await photoWorld(1);
    await runIn(world, ingestArgs(world));
    writeFileSync(join(world.library, '.IMG_0001.jpg.part'), 'x');
    const path = join(world.base, 'report.json');
    const result = await runIn(world, ['doctor', '--report', path]);
    expect(result.stdout.join('\n')).toContain(
      'パス・ファイル名は、伏せてあります'
    );
    const report = JSON.parse(readFileSync(path, 'utf8')) as {
      environment: { seiriVersion: string };
      findings: { title: string; detail?: string }[];
      includePaths: boolean;
    };
    expect(report.environment.seiriVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.includePaths).toBe(false);
    expect(report.findings.some((f) => f.title.includes('一時ファイル'))).toBe(
      true
    );
    expect(report.findings.every((f) => f.detail === undefined)).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toContain(world.library);

    const withPaths = join(world.base, 'report-paths.json');
    await runIn(world, ['doctor', '--report', withPaths, '--include-paths']);
    const detailed = JSON.parse(readFileSync(withPaths, 'utf8')) as {
      findings: { detail?: string }[];
    };
    expect(detailed.findings.some((f) => f.detail?.includes('.part'))).toBe(
      true
    );
  });

  test('.json 以外は、文章で書き出す', async () => {
    const world = await photoWorld(1);
    const path = join(world.base, 'report.txt');
    await runIn(world, ['doctor', '--report', path]);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('seiri 診断の報告');
    expect(text).toContain('要対応');
  });
});
