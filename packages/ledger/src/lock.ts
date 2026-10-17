import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './records/time.ts';

/** ロックの設定。間隔と時間は、ここの 1 か所だけで決める(仕様書 §12) */
export const LOCK_CONFIG = {
  /** ハートビートを更新する間隔(ミリ秒) */
  heartbeatIntervalMs: 10_000,
  /** 最後のハートビートから、この時間(ミリ秒)以上たったら、異常終了と見なす */
  staleAfterMs: 60_000,
} as const;

/** 取り込みの書き込みを直列化するロックの名前 */
export const INGEST_LOCK_NAME = 'ingest';

export type LockInfo = {
  lockName: string;
  holder: string;
  acquiredAt: string;
  heartbeatAt: string;
};

export type AcquireResult =
  // `takeover`: 途絶えたロックを引き継いだとき、前の保持者
  | { acquired: true; takeover: LockInfo | undefined }
  // `heldBy`: 別の実行が、生きたまま持っている
  | { acquired: false; heldBy: LockInfo };

type HolderParts = {
  pid: number;
  hostname: string;
  startedAt: Date;
  /** 取得のたびに変える乱数(同じ pid・ホスト名・起動時刻の取り違えを防ぐ) */
  random: string;
};

/** 保持者の文字列。`pid@ホスト名#起動時刻#乱数` */
export const formatHolderId = (parts: HolderParts): string =>
  `${parts.pid}@${parts.hostname}#${formatTimestamp(parts.startedAt)}#${parts.random}`;

/** 最後のハートビートから、`staleAfterMs` 以上たっていれば、途絶(境界の時間ちょうども、途絶) */
export const isLockStale = (
  heartbeatAt: string,
  now: Date,
  staleAfterMs: number = LOCK_CONFIG.staleAfterMs
): boolean => now.getTime() - Date.parse(heartbeatAt) >= staleAfterMs;

type LockRow = LockInfo;

const COLUMNS = `lock_name AS lockName, holder, acquired_at AS acquiredAt, heartbeat_at AS heartbeatAt`;

export const readLock = (
  db: Database,
  lockName: string
): LockInfo | undefined =>
  db
    .query<LockRow, [string]>(
      `SELECT ${COLUMNS} FROM locks WHERE lock_name = ?`
    )
    .get(lockName) ?? undefined;

/**
 * ロックを取る。1 つのトランザクション(書き込みの権利を先に取る)で、確かめて、書き換える。
 * - なければ、取る。
 * - 同じ保持者なら、ハートビートを更新して、取ったことにする。
 * - 別の保持者で、ハートビートが途絶えていれば、引き継ぐ(前の保持者を `takeover` で返す)。
 * - 別の保持者で、生きていれば、取れない(`heldBy` に、その保持者を返す)。
 */
export const acquireLock = (
  db: Database,
  input: { lockName?: string; holder: string; now: Date }
): AcquireResult => {
  const lockName = input.lockName ?? INGEST_LOCK_NAME;
  const now = formatTimestamp(input.now);
  return db
    .transaction((): AcquireResult => {
      const current = readLock(db, lockName);
      if (!current) {
        db.query(
          'INSERT INTO locks (lock_name, holder, acquired_at, heartbeat_at) VALUES (?, ?, ?, ?)'
        ).run(lockName, input.holder, now, now);
        return { acquired: true, takeover: undefined };
      }
      if (current.holder === input.holder) {
        db.query('UPDATE locks SET heartbeat_at = ? WHERE lock_name = ?').run(
          now,
          lockName
        );
        return { acquired: true, takeover: undefined };
      }
      if (!isLockStale(current.heartbeatAt, input.now)) {
        return { acquired: false, heldBy: current };
      }
      db.query(
        'UPDATE locks SET holder = ?, acquired_at = ?, heartbeat_at = ? WHERE lock_name = ?'
      ).run(input.holder, now, now, lockName);
      return { acquired: true, takeover: current };
    })
    .immediate();
};

/**
 * ハートビートを更新する。保持者が、自分の文字列と**完全に一致するときだけ**更新する。
 * 一致しなければ(別の実行に引き継がれた)、false。
 */
export const refreshLock = (
  db: Database,
  input: { lockName?: string; holder: string; now: Date }
): boolean =>
  db
    .query(
      'UPDATE locks SET heartbeat_at = ? WHERE lock_name = ? AND holder = ?'
    )
    .run(
      formatTimestamp(input.now),
      input.lockName ?? INGEST_LOCK_NAME,
      input.holder
    ).changes === 1;

/** ロックを解放する。保持者が、自分の文字列と完全に一致するときだけ。解放したら true */
export const releaseLock = (
  db: Database,
  input: { lockName?: string; holder: string }
): boolean =>
  db
    .query('DELETE FROM locks WHERE lock_name = ? AND holder = ?')
    .run(input.lockName ?? INGEST_LOCK_NAME, input.holder).changes === 1;

/** ロックの保持者が、いまも自分か */
export const isLockHeldBy = (
  db: Database,
  input: { lockName?: string; holder: string }
): boolean =>
  readLock(db, input.lockName ?? INGEST_LOCK_NAME)?.holder === input.holder;
