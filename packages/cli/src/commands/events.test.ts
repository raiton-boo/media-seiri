import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  openWorldLedger,
  runIn,
  type World,
} from '../ingest/test-support.ts';

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

const ingest = (world: World) =>
  runIn(world, [
    'ingest',
    join(world.srcRoot, 'DCIM'),
    '--dest',
    world.library,
    '--yes',
  ]);

type Row = Record<string, unknown>;
const rows = (world: World, sql: string): Row[] => {
  const ledger = openWorldLedger(world);
  try {
    return ledger.db.query(sql).all() as Row[];
  } finally {
    ledger.close();
  }
};

/** 3 つのできごと: 朝の 2 枚(30 分差)、同じ日の夜の 1 枚(10 時間後)、別の日の 1 枚。日付のない 1 枚は、対象外 */
const addScenePhotos = async (world: World): Promise<void> => {
  await addPhoto(world, 'DCIM/a.jpg', {
    DateTimeOriginal: '2024:03:05 10:00:00',
  });
  await addPhoto(world, 'DCIM/b.jpg', {
    DateTimeOriginal: '2024:03:05 10:30:00',
  });
  await addPhoto(world, 'DCIM/c.jpg', {
    DateTimeOriginal: '2024:03:05 20:30:00',
  });
  await addPhoto(world, 'DCIM/d.jpg', {
    DateTimeOriginal: '2024:03:07 09:00:00',
  });
};

describe('アルバムのできごとの保存', () => {
  test('取り込みの最後に、できごとを計算して、台帳に保存する(写真の所属・代表・リビジョン)', async () => {
    const world = await newWorld();
    await addScenePhotos(world);
    await addPhoto(world, 'DCIM/nodate.jpg');
    const result = await ingest(world);
    expect(result.stdout.join('\n')).not.toContain('できごと'); // 画面には出さない(イベントに残す)

    const events = rows(
      world,
      'SELECT start_at, end_at, file_count, rule, computed_revision FROM album_events ORDER BY start_at'
    );
    expect(events.map((e) => [e.start_at, e.file_count])).toEqual([
      ['2024-03-05T10:00:00', 2],
      ['2024-03-05T20:30:00', 1],
      ['2024-03-07T09:00:00', 1],
    ]);
    expect(events[0]).toMatchObject({
      end_at: '2024-03-05T10:30:00',
      rule: '4h/5km',
    });
    // 計算したときのリビジョン = 取り込みを終えたときのリビジョン
    const [{ revision_after }] = rows(
      world,
      'SELECT revision_after FROM runs'
    ) as [{ revision_after: number }];
    expect(events.every((e) => e.computed_revision === revision_after)).toBe(
      true
    );
    // 写真の所属: 日付のない写真は、どのできごとにも属さない
    expect(
      rows(
        world,
        'SELECT count(*) AS n FROM library_files WHERE album_event_id IS NOT NULL'
      )[0]
    ).toEqual({ n: 4 });
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM library_files WHERE bucket LIKE 'unknown%' AND album_event_id IS NULL"
      )[0]
    ).toEqual({ n: 1 });
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM events WHERE code = 'ALBUM_EVENTS'"
      )[0]
    ).toEqual({ n: 1 });
  });

  test('dry-run では、計算も保存もしない', async () => {
    const world = await newWorld();
    await addScenePhotos(world);
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--dry-run',
    ]);
    expect(rows(world, 'SELECT count(*) AS n FROM album_events')[0]).toEqual({
      n: 0,
    });
  });

  test('events コマンド: 計算し直す(結果は同じ)。リビジョンが +1 され、スナップショットも新しくなる', async () => {
    const world = await newWorld();
    await addScenePhotos(world);
    await ingest(world);
    const before = rows(
      world,
      "SELECT value FROM meta WHERE key = 'revision'"
    )[0]?.value;
    // 一度、すべて消して、計算し直しで、元に戻ることを確かめる
    const ledger = openWorldLedger(world);
    ledger.db.query('DELETE FROM album_events').run();
    ledger.close();

    const result = await runIn(world, ['events', '--library', world.library]);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('3 件(対象 4 枚');
    expect(rows(world, 'SELECT count(*) AS n FROM album_events')[0]).toEqual({
      n: 3,
    });
    const after = rows(
      world,
      "SELECT value FROM meta WHERE key = 'revision'"
    )[0]?.value;
    expect(Number(after)).toBe(Number(before) + 1);
    expect(
      existsSync(join(world.library, '.file-seiri', 'catalog.snapshot.sqlite'))
    ).toBe(true);
    expect(
      rows(world, 'SELECT DISTINCT computed_revision AS r FROM album_events')
    ).toEqual([{ r: Number(after) }]);
  });

  test('ライブラリでない場所を指すと、エラーで止まる', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['events', '--library', world.srcRoot]);
    expect(result.code).toBe(EXIT_CODES.failed);
  });
});
