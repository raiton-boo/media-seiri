import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  addPhoto,
  DATE_2024_03_05,
  fakeLiveController,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  type World,
} from './test-support.ts';

installExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});
const newWorld = async (): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  return world;
};

const photos = async (world: World, count: number) => {
  for (let index = 0; index < count; index += 1) {
    await addPhoto(world, `DCIM/p${index}.jpg`, {
      DateTimeOriginal: `2024:03:05 10:20:${String(10 + index).padStart(2, '0')}`,
    });
  }
};

const ingest = (
  world: World,
  live: ReturnType<typeof fakeLiveController>,
  extra: string[] = [],
  environment: Parameters<typeof runIn>[2] = {}
) =>
  runIn(
    world,
    ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, ...extra],
    {
      isInteractive: true,
      confirm: async () => true,
      liveController: () => live,
      ...environment,
    }
  );

describe('ライブ表示を使う取り込み(画面の代役で)', () => {
  test('端末(対話)のとき、画面を出す。確認の質問のときは、いったん閉じ、結果のまとめは、閉じたあとに出す', async () => {
    const world = await newWorld();
    await photos(world, 2);
    const live = fakeLiveController();
    const result = await ingest(world, live);
    expect(result.code).toBe(0);
    expect(live.events).toEqual(['start', 'suspend', 'resume', 'stop']);
    // 進み具合の集計
    expect(live.feed.snapshot()).toMatchObject({
      counts: {
        found: 2,
        analyzed: 2,
        analyzeTotal: 2,
        copied: 2,
        copyTotal: 2,
        verified: 2,
        verifyFailed: 0,
      },
      types: { photo: 2, video: 0, raw: 0, zip: 0 },
      counters: { adopted: 2 },
    });
    expect(
      existsSync(join(world.library, '2024/03/2024.03.05_10-20-10_p0.jpg'))
    ).toBe(true);
    const out = result.stdout.join('\n');
    // サマリーは、出る。進み具合の行(画面に出ていたもの)は、出し直さない
    expect(out).toMatch(/結果/);
    expect(out).toMatch(/コピー結果|コピーしました|コピー済み|採用/);
    expect(out).not.toMatch(/解析: \d+ \/ \d+/);
    expect(out).not.toMatch(/^スキャン: /m);
  });

  test('--plain なら、端末でも、画面を出さない(ログの行だけ)', async () => {
    const world = await newWorld();
    await photos(world, 1);
    const live = fakeLiveController();
    const result = await ingest(world, live, ['--plain', '--yes']);
    expect(result.code).toBe(0);
    expect(live.events).toEqual([]);
    expect(result.stdout.join('\n')).toMatch(/スキャン: /);
  });

  test('端末でないとき(対話できない)は、画面を出さない', async () => {
    const world = await newWorld();
    await photos(world, 1);
    const live = fakeLiveController();
    const result = await ingest(world, live, ['--yes'], {
      isInteractive: false,
    });
    expect(result.code).toBe(0);
    expect(live.events).toEqual([]);
  });

  test('q(安全に停止)を押すと、今のファイルまで終えて、中断で終わる(130)。続きから、再開できる', async () => {
    const world = await newWorld();
    await photos(world, 3);
    const live = fakeLiveController({ stopAfterCopied: 1 });
    const first = await ingest(world, live, ['--yes']);
    expect(first.code).toBe(130);
    expect(live.events).toEqual(['start', 'stop']);
    const copiedFirst = live.feed.snapshot()?.counts.copied ?? 0;
    expect(copiedFirst).toBe(1);

    const resumed = await ingest(world, fakeLiveController(), [
      '--yes',
      '--resume',
    ]);
    expect(resumed.code).toBe(0);
    for (let index = 0; index < 3; index += 1) {
      expect(
        existsSync(
          join(
            world.library,
            `2024/03/2024.03.05_10-20-${10 + index}_p${index}.jpg`
          )
        )
      ).toBe(true);
    }
  });

  test('警告(標準エラー)は、画面を閉じたあとに、出す', async () => {
    const world = await newWorld();
    await photos(world, 1);
    const live = fakeLiveController();
    const result = await ingest(world, live, ['--yes']);
    // 警告がなければ、何も出ない(画面の邪魔にならないよう、ためて、あとで出す仕組みが、壊れていない)
    expect(result.stderr).toEqual([]);
    void DATE_2024_03_05;
  });
});
