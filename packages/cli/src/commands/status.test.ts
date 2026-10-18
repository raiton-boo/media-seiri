import { afterEach, describe, expect, test } from 'bun:test';
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
const text = (result: { stdout: string[] }): string => result.stdout.join('\n');
const setLock = (world: World, holder: string, heartbeatAt: Date): void => {
  const ledger = openWorldLedger(world);
  ledger.db
    .query(
      "INSERT OR REPLACE INTO locks (lock_name, holder, acquired_at, heartbeat_at) VALUES ('ingest', ?, ?, ?)"
    )
    .run(
      holder,
      new Date(heartbeatAt.getTime() - 5000).toISOString(),
      heartbeatAt.toISOString()
    );
  ledger.close();
};

describe('status', () => {
  test('実行がなければ、ロックなし・記録なし', async () => {
    const world = await newLibrary();
    const result = await runIn(world, ['status']);
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text(result)).toMatch(/^ライブラリ: [0-9a-z-]{1,8} {2}/);
    expect(text(result)).toContain('ロック: なし');
    expect(text(result)).toContain('実行: まだ記録がありません');
  });

  test('取り込みのあと: 直近の実行(状態・ソース・ファイルの状態別の数・エラー・最後のイベント)と、最近の実行', async () => {
    const world = await newLibrary();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    addFile(world, 'DCIM/empty.jpg', '');
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ]);
    await runIn(world, ['verify', '--library', world.library]);
    const result = await runIn(world, ['status']);
    const out = text(result);
    expect(out).toContain('ロック: なし');
    expect(out).toMatch(
      /直近の実行: #2 検査 {2}完了 {2}開始 2026-10-18 09:00:00 {2}終了 2026-10-18 09:00:00/
    );
    expect(out).toContain('対象: Library');
    expect(out).toMatch(/最後のイベント: .* INFO {2}#2 RUN_END /);
    expect(out).toContain('最近の実行:');
    expect(out).toContain('#1 取り込み  完了');
    expect(out).toContain('#2 検査  完了');

    // 取り込みの実行の詳細: ファイルの状態別の数と、エラー
    const detail = text(await runIn(world, ['status']));
    expect(detail).not.toContain('ファイル:'); // 直近は検査(ソースのファイルを持たない)
  });

  test('直近が取り込みなら、ファイルの状態別の数・エラーを表示する', async () => {
    const world = await newLibrary();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    addFile(world, 'DCIM/empty.jpg', '');
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ]);
    const out = text(await runIn(world, ['status']));
    expect(out).toContain('直近の実行: #1 取り込み  完了');
    expect(out).toContain('ソース: Source');
    expect(out).toMatch(/ファイル: done 1 \/ error 1/);
    expect(out).toContain('エラー: 1 件(EMPTY_FILE 1)');
  });

  test('ロックがあれば、保持者・開始・最後の生存通知(何秒前)を表示する', async () => {
    const world = await newLibrary();
    setLock(world, 'busy-holder', new Date(NOW.getTime() - 12_000));
    const out = text(await runIn(world, ['status']));
    expect(out).toContain('ロック: 保持者 busy-holder');
    expect(out).toMatch(/最後の生存通知 2026-10-18 08:59:48\(12 秒前\)/);
    expect(out).not.toContain('途絶');
  });

  test('生存通知が 60 秒以上途絶えていれば、異常終了の可能性を案内する(59 秒は、案内しない)', async () => {
    const world = await newLibrary();
    setLock(world, 'slow', new Date(NOW.getTime() - 59_000));
    expect(text(await runIn(world, ['status']))).not.toContain('途絶');
    setLock(world, 'dead', new Date(NOW.getTime() - 60_000));
    const out = text(await runIn(world, ['status']));
    expect(out).toContain('60 秒以上途絶えています');
    expect(out).toContain('自動で引き継ぎます');
  });

  test('実行中のまま、ロックがないときは、異常終了の可能性を案内する', async () => {
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
    const out = text(await runIn(world, ['status']));
    expect(out).toContain('実行中');
    expect(out).toContain('ロックがありません');
  });

  test('余計な引数は、使い方の誤り(2)。登録がなければ 2', async () => {
    const world = await newLibrary();
    expect((await runIn(world, ['status', 'extra'])).code).toBe(
      EXIT_CODES.failed
    );
    const empty = makeWorld();
    worlds.push(empty);
    expect((await runIn(empty, ['status'])).code).toBe(EXIT_CODES.failed);
  });
});
