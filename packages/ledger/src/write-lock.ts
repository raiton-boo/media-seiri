import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { LedgerError } from './errors.ts';
import type { Ledger } from './ledger.ts';
import {
  type AcquireResult,
  acquireLock,
  formatHolderId,
  INGEST_LOCK_NAME,
  isLockHeldBy,
  LOCK_CONFIG,
  type LockInfo,
  refreshLock,
  releaseLock,
} from './lock.ts';

const RANDOM_BYTES = 8;

/** このプロセスの、新しい保持者の文字列。取得のたびに、新しい乱数を付ける */
export const newHolderId = (now: Date = new Date()): string =>
  formatHolderId({
    pid: process.pid,
    hostname: hostname(),
    // 起動時刻: いまから、起動してからの経過を引く
    startedAt: new Date(now.getTime() - process.uptime() * 1000),
    random: randomBytes(RANDOM_BYTES).toString('hex'),
  });

/** ロックを失ったあとに、書き込もうとしたときのエラー。書き込みは、行われない */
export class LockLostError extends LedgerError {
  constructor(lockName: string, holder: string) {
    super(
      'LOCK_LOST',
      `ロック(${lockName})の保持者が、自分(${holder})ではなくなりました。書き込みを止めます`
    );
    this.name = 'LockLostError';
  }
}

export type HeartbeatOptions = {
  /** 呼ぶたびの、いまの時刻(テストで差し替える) */
  now: () => Date;
  /** ロックを失ったとき(1 度だけ呼ぶ)。呼び出し側は、安全に止まる */
  onLost: () => void;
  /** ハートビートの更新に、失敗したとき(台帳が閉じている、など)。握りつぶさず、呼び出し側に渡す */
  onError: (error: unknown) => void;
  intervalMs?: number;
};

/** 取れたロック。書き込みは、`transaction` を通す */
export type WriteLock = {
  readonly lockName: string;
  readonly holder: string;
  isLost(): boolean;
  /** ハートビートを更新する。保持者が自分でなければ、失ったことを覚えて、false */
  heartbeat(now: Date): boolean;
  /**
   * 書き込みのトランザクション。始めるときに、保持者がまだ自分かを確かめる。
   * 確かめと書き込みは、同じトランザクションの中なので、間に別の実行が割り込めない
   * (スリープから復帰して、ロックを取られたあとの、二重の書き込みを防ぐ)。
   */
  transaction<T>(work: () => T): T;
  /** 一定の間隔で、ハートビートを更新する。止める関数を返す */
  startHeartbeat(options: HeartbeatOptions): () => void;
  release(): void;
};

export type WriteLockResult =
  | { acquired: true; lock: WriteLock; takeover: LockInfo | undefined }
  | Extract<AcquireResult, { acquired: false }>;

/**
 * 書き込みのロックを取る。書き込み用に開いた台帳だけで取れる。
 * 取れなかったときは、保持者を返す(呼び出し側が、表示して、すぐ終了する。仕様書 §12)。
 */
export const acquireWriteLock = (
  ledger: Ledger,
  input: { holder: string; now: Date; lockName?: string }
): WriteLockResult => {
  if (ledger.mode !== 'readwrite') {
    throw new Error('ロックは、書き込み用に開いた台帳でだけ取れます');
  }
  const lockName = input.lockName ?? INGEST_LOCK_NAME;
  const { holder } = input;
  const { db } = ledger;
  const result = acquireLock(db, { lockName, holder, now: input.now });
  if (!result.acquired) return result;

  let lost = false;
  const markLost = (): void => {
    lost = true;
  };

  const lock: WriteLock = {
    lockName,
    holder,
    isLost: () => lost,
    heartbeat: (now) => {
      if (lost) return false;
      const ok = refreshLock(db, { lockName, holder, now });
      if (!ok) markLost();
      return ok;
    },
    transaction: (work) => {
      if (lost) throw new LockLostError(lockName, holder);
      return db
        .transaction(() => {
          if (!isLockHeldBy(db, { lockName, holder })) {
            markLost();
            throw new LockLostError(lockName, holder);
          }
          return work();
        })
        .immediate();
    },
    startHeartbeat: (options) => {
      const timer = setInterval(() => {
        try {
          if (!lock.heartbeat(options.now())) {
            clearInterval(timer);
            options.onLost();
          }
        } catch (error) {
          options.onError(error);
        }
      }, options.intervalMs ?? LOCK_CONFIG.heartbeatIntervalMs);
      // 台帳を閉じ忘れても、タイマーだけで、プロセスを生かし続けない
      timer.unref();
      return () => clearInterval(timer);
    },
    release: () => {
      if (!lost) releaseLock(db, { lockName, holder });
      markLost();
    },
  };
  return { acquired: true, lock, takeover: result.takeover };
};
