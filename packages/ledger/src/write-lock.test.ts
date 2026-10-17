import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { openLedger } from './ledger.ts';
import { readLock } from './lock.ts';
import { makeTempDir, openMemoryLedger } from './test-helpers.ts';
import { acquireWriteLock, LockLostError } from './write-lock.ts';

const T0 = new Date('2026-10-18T00:00:00.000Z');
const after = (seconds: number): Date =>
  new Date(T0.getTime() + seconds * 1000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 同じファイルを、2 つの接続(2 つの実行)で開く */
const openTwo = () => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  const path = join(dir, 'catalog.sqlite');
  const a = openLedger(path, { libraryId: 'abc' });
  const b = openLedger(path, { libraryId: 'abc' });
  cleanups.push(() => {
    a.close();
    b.close();
  });
  return { a, b };
};

const insertVolume = (
  ledger: ReturnType<typeof openMemoryLedger>,
  uuid: string
): void => {
  ledger.db
    .query(
      "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES (?, '2026-10-18T00:00:00Z')"
    )
    .run(uuid);
};
const countVolumes = (ledger: ReturnType<typeof openMemoryLedger>): number =>
  (ledger.db.query('SELECT count(*) AS n FROM volumes').get() as { n: number })
    .n;

describe('acquireWriteLock', () => {
  test('読み取り専用の台帳では、取れない', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const path = join(dir, 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();
    const readonly = openLedger(path, { mode: 'readonly' });
    expect(() =>
      acquireWriteLock(readonly, { holder: 'h', now: T0 })
    ).toThrow();
    readonly.close();
  });

  test('取れたら、transaction で書き込める。解放すると、次の実行が取れる', () => {
    const { a, b } = openTwo();
    const result = acquireWriteLock(a, { holder: 'one', now: T0 });
    if (!result.acquired) throw new Error('取れるはず');
    expect(result.takeover).toBeUndefined();
    result.lock.transaction(() => insertVolume(a, 'v1'));
    expect(countVolumes(a)).toBe(1);

    expect(acquireWriteLock(b, { holder: 'two', now: after(1) })).toMatchObject(
      {
        acquired: false,
        heldBy: { holder: 'one' },
      }
    );
    result.lock.release();
    expect(readLock(b.db, 'ingest')).toBeUndefined();
    expect(acquireWriteLock(b, { holder: 'two', now: after(2) }).acquired).toBe(
      true
    );
  });

  test('途絶えたロックを引き継ぐと、前の保持者が分かる', () => {
    const { a, b } = openTwo();
    acquireWriteLock(a, { holder: 'one', now: T0 });
    const result = acquireWriteLock(b, { holder: 'two', now: after(61) });
    expect(result).toMatchObject({
      acquired: true,
      takeover: { holder: 'one' },
    });
  });
});

describe('ロックを失ったあとの安全な停止', () => {
  const setup = () => {
    const { a, b } = openTwo();
    const first = acquireWriteLock(a, { holder: 'one', now: T0 });
    if (!first.acquired) throw new Error('取れるはず');
    // 最初の実行が、スリープして、61 秒後に、別の実行が引き継ぐ
    const second = acquireWriteLock(b, { holder: 'two', now: after(61) });
    if (!second.acquired) throw new Error('引き継げるはず');
    return { a, b, first: first.lock, second: second.lock };
  };

  test('復帰した前の実行の、ハートビートは false。ロックを失ったと覚える', () => {
    const { first, b } = setup();
    expect(first.isLost()).toBe(false);
    expect(first.heartbeat(after(62))).toBe(false);
    expect(first.isLost()).toBe(true);
    expect(readLock(b.db, 'ingest')?.holder).toBe('two');
  });

  test('復帰した前の実行の、transaction は、書き込まずに LockLostError', () => {
    const { a, first } = setup();
    expect(() => first.transaction(() => insertVolume(a, 'late'))).toThrow(
      LockLostError
    );
    expect(countVolumes(a)).toBe(0);
    // ハートビートを待たなくても、transaction が、自分で気づく
    expect(first.isLost()).toBe(true);
  });

  test('失ったあとに解放しても、新しい保持者のロックは消えない', () => {
    const { b, first } = setup();
    first.release();
    expect(readLock(b.db, 'ingest')?.holder).toBe('two');
  });

  test('新しい保持者は、そのまま書き込める', () => {
    const { b, second } = setup();
    second.transaction(() => insertVolume(b, 'ok'));
    expect(countVolumes(b)).toBe(1);
  });

  test('失ったあとは、ハートビートも transaction も、台帳を見ずに失敗する', () => {
    const { a, first } = setup();
    first.heartbeat(after(62));
    expect(first.heartbeat(after(63))).toBe(false);
    expect(() => first.transaction(() => insertVolume(a, 'x'))).toThrow(
      LockLostError
    );
  });
});

describe('startHeartbeat', () => {
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  test('一定の間隔で更新し、止める関数で止まる', async () => {
    const { a } = openTwo();
    const result = acquireWriteLock(a, { holder: 'one', now: T0 });
    if (!result.acquired) throw new Error('取れるはず');
    let tick = 0;
    const stop = result.lock.startHeartbeat({
      intervalMs: 5,
      now: () => {
        tick += 1;
        return after(tick);
      },
      onLost: () => {
        throw new Error('失っていないはず');
      },
      onError: (error) => {
        throw error;
      },
    });
    await wait(40);
    stop();
    const seen = tick;
    expect(seen).toBeGreaterThan(1);
    expect(readLock(a.db, 'ingest')?.heartbeatAt).toBe(
      after(seen).toISOString()
    );
    await wait(20);
    expect(tick).toBe(seen);
  });

  test('ロックを失うと、onLost を 1 度だけ呼んで、止まる', async () => {
    const { a, b } = openTwo();
    const first = acquireWriteLock(a, { holder: 'one', now: T0 });
    if (!first.acquired) throw new Error('取れるはず');
    acquireWriteLock(b, { holder: 'two', now: after(61) });
    let lostCount = 0;
    first.lock.startHeartbeat({
      intervalMs: 5,
      now: () => after(62),
      onLost: () => {
        lostCount += 1;
      },
      onError: (error) => {
        throw error;
      },
    });
    await wait(40);
    expect(lostCount).toBe(1);
    expect(first.lock.isLost()).toBe(true);
  });

  test('更新に失敗したら(台帳が閉じている)、onError に渡す', async () => {
    const ledger = openMemoryLedger();
    const result = acquireWriteLock(ledger, { holder: 'one', now: T0 });
    if (!result.acquired) throw new Error('取れるはず');
    const errors: unknown[] = [];
    const stop = result.lock.startHeartbeat({
      intervalMs: 5,
      now: () => after(1),
      onLost: () => {},
      onError: (error) => errors.push(error),
    });
    ledger.close();
    await wait(30);
    stop();
    expect(errors.length).toBeGreaterThan(0);
  });
});
