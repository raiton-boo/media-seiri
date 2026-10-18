import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig, registerLibrary } from '../config/registry.ts';
import {
  initLibrary,
  makeWorld,
  runIn,
  scriptedAsker,
  type World,
} from '../ingest/test-support.ts';
import { markerPathOf } from './marker.ts';

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});

/** ライブラリを 2 つ持つ世界(`world.library` と、`second`) */
const twoLibraries = async (): Promise<{ world: World; second: string }> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  const second = join(world.destDrive, 'Second');
  const created = await runIn(world, ['library', 'init', second], {
    newLibraryId: () => 'lib-2',
  });
  expect(created.code).toBe(0);
  return { world, second };
};

describe('ライブラリの選び方(--library を省いたとき)', () => {
  test('登録が 1 つだけなら、それ', async () => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    const result = await runIn(world, ['status']);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain(world.library);
  });

  test('複数あっても、接続中が 1 つだけなら、それを自動で使う', async () => {
    const { world, second } = await twoLibraries();
    // 2 つ目の、ドライブが外れた(目印が見えない)
    rmSync(second, { recursive: true, force: true });
    const result = await runIn(world, ['status']);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain(world.library);
  });

  test('接続中が複数で、端末でなければ、一覧つきのエラー(2)', async () => {
    const { world, second } = await twoLibraries();
    const result = await runIn(world, ['status']);
    expect(result.code).toBe(2);
    const text = result.stderr.join('\n');
    expect(text).toContain('ライブラリが複数あります');
    expect(text).toContain(world.library);
    expect(text).toContain(second);
    expect(text).toContain('library list');
  });

  test('接続中が複数で、端末なら、一覧から選べる', async () => {
    const { world, second } = await twoLibraries();
    const ask = scriptedAsker([second]);
    const result = await runIn(world, ['status'], {
      isInteractive: true,
      ask,
    });
    expect(result.code).toBe(0);
    expect(ask.asked).toEqual(['どのライブラリにしますか?']);
    expect(result.stdout.join('\n')).toContain(second);
  });

  test('--library を指定すれば、聞かない', async () => {
    const { world, second } = await twoLibraries();
    const ask = scriptedAsker([]);
    const result = await runIn(world, ['status', '--library', second], {
      isInteractive: true,
      ask,
    });
    expect(result.code).toBe(0);
    expect(ask.asked).toEqual([]);
  });
});

describe('library list', () => {
  test('登録済みの一覧と、接続中かどうかを出す', async () => {
    const { world, second } = await twoLibraries();
    rmSync(second, { recursive: true, force: true });
    const result = await runIn(world, ['library', 'list']);
    expect(result.code).toBe(0);
    const text = result.stdout.join('\n');
    expect(text).toContain(world.library);
    expect(text).toContain('接続中');
    expect(text).toContain('ドライブ未接続');
  });

  test('1 つもなければ、作り方を案内する', async () => {
    const world = makeWorld();
    worlds.push(world);
    const result = await runIn(world, ['library', 'list']);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain('library init');
  });
});

describe('古い登録(同じ場所に、作り直したライブラリがある)', () => {
  /** 同じ場所に、別の ID の登録が、残っている世界(作り直しの、あとの状態) */
  const withStale = async (): Promise<World> => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    for (const id of ['old-1', 'old-2']) {
      registerLibrary(world.dataDir, id, {
        root: world.library,
        registeredAt: '2026-10-01T00:00:00.000Z',
      });
    }
    return world;
  };

  test('選択肢に入れない。接続中の 1 つが、自動で使われる', async () => {
    const world = await withStale();
    const result = await runIn(world, ['status']);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain(world.library);
  });

  test('library list に、古い登録と出て、prune の案内も出る', async () => {
    const world = await withStale();
    const text = (await runIn(world, ['library', 'list'])).stdout.join('\n');
    expect(text.match(/古い登録(?!が)/g)).toHaveLength(2);
    expect(text).toContain('library prune');
  });

  test('prune は、古い登録だけを、設定から外す。台帳・ライブラリは、そのまま。端末でなければ、--yes が要る', async () => {
    const world = await withStale();
    const refused = await runIn(world, ['library', 'prune']);
    expect(refused.code).toBe(2);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toHaveLength(3);

    const done = await runIn(world, ['library', 'prune', '--yes']);
    expect(done.code).toBe(0);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual(['lib-1']);
    // ライブラリの目印は、残っている
    expect(await Bun.file(markerPathOf(world.library)).exists()).toBe(true);
    // 2 回目は、何もない
    const again = await runIn(world, ['library', 'prune', '--yes']);
    expect(again.stdout.join('\n')).toContain('古い登録は、ありません');
  });

  test('同じ場所に、作り直すと、前の登録は、外れる', async () => {
    const world = await withStale();
    rmSync(markerPathOf(world.library), { force: true });
    const created = await runIn(world, ['library', 'init', world.library], {
      newLibraryId: () => 'lib-new',
    });
    expect(created.code).toBe(0);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual([
      'lib-new',
    ]);
  });
});
