import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { openLedger } from './ledger.ts';
import {
  acquireLock,
  formatHolderId,
  INGEST_LOCK_NAME,
  isLockHeldBy,
  isLockStale,
  LOCK_CONFIG,
  readLock,
  refreshLock,
  releaseLock,
} from './lock.ts';
import { makeTempDir, openMemoryLedger } from './test-helpers.ts';
import { newHolderId } from './write-lock.ts';

const T0 = new Date('2026-10-18T00:00:00.000Z');
const after = (seconds: number): Date =>
  new Date(T0.getTime() + seconds * 1000);
const HOLDER = '100@mac#2026-10-18T00:00:00.000Z#aaaa';

describe('LOCK_CONFIG', () => {
  test('間隔は 10 秒、途絶は 60 秒(仕様書 §12)', () => {
    expect(LOCK_CONFIG.heartbeatIntervalMs).toBe(10_000);
    expect(LOCK_CONFIG.staleAfterMs).toBe(60_000);
  });
});

describe('保持者の文字列', () => {
  test('pid・ホスト名・起動時刻・乱数を、並べる', () => {
    expect(
      formatHolderId({
        pid: 100,
        hostname: 'mac',
        startedAt: T0,
        random: 'ab12',
      })
    ).toBe('100@mac#2026-10-18T00:00:00.000Z#ab12');
  });

  test('取得のたびに、乱数が変わる(同じプロセスでも、別の文字列)', () => {
    const first = newHolderId(T0);
    const second = newHolderId(T0);
    expect(first).not.toBe(second);
    expect(first.startsWith(`${process.pid}@`)).toBe(true);
  });
});

describe('isLockStale(途絶の境界)', () => {
  const heartbeat = T0.toISOString();
  test('59 秒は、途絶ではない', () => {
    expect(isLockStale(heartbeat, after(59))).toBe(false);
    expect(isLockStale(heartbeat, new Date(T0.getTime() + 59_999))).toBe(false);
  });
  test('60 秒ちょうど以上は、途絶', () => {
    expect(isLockStale(heartbeat, after(60))).toBe(true);
    expect(isLockStale(heartbeat, after(61))).toBe(true);
  });
  test('時計が戻って、ハートビートが未来にあるときは、途絶ではない', () => {
    expect(isLockStale(after(30).toISOString(), T0)).toBe(false);
  });
});

describe('acquireLock', () => {
  test('空なら、取れる。保持者と時刻が入る', () => {
    const { db } = openMemoryLedger();
    expect(acquireLock(db, { holder: HOLDER, now: T0 })).toEqual({
      acquired: true,
      takeover: undefined,
    });
    expect(readLock(db, INGEST_LOCK_NAME)).toEqual({
      lockName: INGEST_LOCK_NAME,
      holder: HOLDER,
      acquiredAt: '2026-10-18T00:00:00.000Z',
      heartbeatAt: '2026-10-18T00:00:00.000Z',
    });
  });

  test('生きている別の保持者がいれば、取れない(保持者を返す)', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { holder: HOLDER, now: T0 });
    const result = acquireLock(db, { holder: 'other', now: after(59) });
    expect(result).toMatchObject({
      acquired: false,
      heldBy: { holder: HOLDER },
    });
    expect(readLock(db, INGEST_LOCK_NAME)?.holder).toBe(HOLDER);
  });

  test('59 秒では引き継げず、60 秒・61 秒で、引き継げる(前の保持者を返す)', () => {
    for (const [seconds, expected] of [
      [59, false],
      [60, true],
      [61, true],
    ] as const) {
      const { db } = openMemoryLedger();
      acquireLock(db, { holder: HOLDER, now: T0 });
      const result = acquireLock(db, { holder: 'other', now: after(seconds) });
      expect(result.acquired).toBe(expected);
      if (result.acquired) {
        expect(result.takeover?.holder).toBe(HOLDER);
        expect(readLock(db, INGEST_LOCK_NAME)).toMatchObject({
          holder: 'other',
          acquiredAt: after(seconds).toISOString(),
        });
      }
    }
  });

  test('ハートビートを更新していれば、60 秒たっても、引き継げない', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { holder: HOLDER, now: T0 });
    refreshLock(db, { holder: HOLDER, now: after(50) });
    expect(acquireLock(db, { holder: 'other', now: after(100) }).acquired).toBe(
      false
    );
    expect(acquireLock(db, { holder: 'other', now: after(110) }).acquired).toBe(
      true
    );
  });

  test('同じ保持者が、もう一度取ると、ハートビートを更新するだけ', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { holder: HOLDER, now: T0 });
    expect(acquireLock(db, { holder: HOLDER, now: after(5) })).toEqual({
      acquired: true,
      takeover: undefined,
    });
    expect(readLock(db, INGEST_LOCK_NAME)).toMatchObject({
      acquiredAt: T0.toISOString(),
      heartbeatAt: after(5).toISOString(),
    });
  });

  test('ロックの名前ごとに、別々', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { lockName: 'a', holder: 'x', now: T0 });
    expect(
      acquireLock(db, { lockName: 'b', holder: 'y', now: T0 }).acquired
    ).toBe(true);
  });
});

describe('保持者の完全一致(refreshLock・releaseLock)', () => {
  const lookalikes = [
    `${HOLDER} `, // 末尾に空白
    HOLDER.toUpperCase(), // 大文字小文字
    HOLDER.slice(0, -1), // 前方一致
    `${HOLDER}x`, // 後方に足したもの
    HOLDER.replace('aaaa', 'aaab'), // 乱数だけが違う
    '',
  ];

  test('自分の文字列だけが、更新・解放できる', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { holder: HOLDER, now: T0 });
    for (const other of lookalikes) {
      expect(refreshLock(db, { holder: other, now: after(5) })).toBe(false);
      expect(releaseLock(db, { holder: other })).toBe(false);
      expect(isLockHeldBy(db, { holder: other })).toBe(false);
    }
    expect(readLock(db, INGEST_LOCK_NAME)).toMatchObject({
      holder: HOLDER,
      heartbeatAt: T0.toISOString(),
    });
    expect(refreshLock(db, { holder: HOLDER, now: after(5) })).toBe(true);
    expect(releaseLock(db, { holder: HOLDER })).toBe(true);
    expect(readLock(db, INGEST_LOCK_NAME)).toBeUndefined();
  });

  test('引き継がれたあとは、前の保持者は、更新も解放もできない', () => {
    const { db } = openMemoryLedger();
    acquireLock(db, { holder: HOLDER, now: T0 });
    acquireLock(db, { holder: 'new', now: after(61) });
    expect(refreshLock(db, { holder: HOLDER, now: after(62) })).toBe(false);
    expect(releaseLock(db, { holder: HOLDER })).toBe(false);
    expect(readLock(db, INGEST_LOCK_NAME)?.holder).toBe('new');
  });

  test('ロックがなければ、どちらも false', () => {
    const { db } = openMemoryLedger();
    expect(refreshLock(db, { holder: HOLDER, now: T0 })).toBe(false);
    expect(releaseLock(db, { holder: HOLDER })).toBe(false);
  });
});

describe('別の接続(別の実行)との間で', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  test('同じ台帳のファイルを、2 つの接続で開くと、1 つ目だけが取れる', () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const path = join(dir, 'catalog.sqlite');
    const first = openLedger(path, { libraryId: 'abc' });
    const second = openLedger(path, { libraryId: 'abc' });
    expect(acquireLock(first.db, { holder: 'one', now: T0 }).acquired).toBe(
      true
    );
    expect(
      acquireLock(second.db, { holder: 'two', now: after(1) })
    ).toMatchObject({
      acquired: false,
      heldBy: { holder: 'one' },
    });
    first.close();
    second.close();
  });
});
