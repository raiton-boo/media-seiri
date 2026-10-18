import {
  acquireWriteLock,
  interruptRunningRuns,
  type Ledger,
  type LockInfo,
  newHolderId,
  type WriteLock,
} from '@file-seiri/ledger';
import type { CommandContext } from '../context.ts';

export type LockSession = {
  lock: WriteLock;
  /** 途絶えたロックを引き継いだとき、前の保持者と、中断として記録した実行 */
  takeover: { previous: LockInfo; interruptedRuns: number[] } | undefined;
  /** ハートビートを止める(ロックの解放は、呼び出し側が `lock.release()` で行う) */
  stopHeartbeat: () => void;
};

/**
 * ライブラリへの書き込みのロックを取る(取り込み・検査で共通。仕様書 §12)。
 * - 取れなければ、保持者を表示して、undefined(呼び出し側が、すぐ終了する)
 * - 途絶えていれば、引き継ぎ、実行中のまま残っていた前の実行を `interrupted` にする
 * - ハートビートを、10 秒おきに更新する。ロックを失ったときは、警告を出す(書き込みは、`lock.transaction` が止める)
 */
export const acquireLockSession = (
  context: CommandContext,
  ledger: Ledger
): LockSession | undefined => {
  const acquired = acquireWriteLock(ledger, {
    holder: newHolderId(context.now()),
    now: context.now(),
  });
  if (!acquired.acquired) {
    const { holder, acquiredAt, heartbeatAt } = acquired.heldBy;
    context.stderr(
      `エラー: 別の実行が、このライブラリに書き込んでいます。\n  保持者: ${holder}\n  開始: ${acquiredAt}\n  最後の生存通知: ${heartbeatAt}\n` +
        '終わるのを待つか、異常終了した場合は、60 秒たってから、もう一度実行してください(途絶えたロックは、自動で引き継ぎます)。'
    );
    return undefined;
  }
  const { lock } = acquired;
  const stopHeartbeat = lock.startHeartbeat({
    now: context.now,
    onLost: () =>
      context.stderr(
        '警告: ロックを失いました(別の実行が、引き継ぎました)。書き込みを止めます。'
      ),
    onError: (error) =>
      context.stderr(
        `警告: ロックの生存通知を更新できませんでした: ${error instanceof Error ? error.message : String(error)}`
      ),
  });
  let takeover: LockSession['takeover'];
  if (acquired.takeover) {
    const interrupted = lock.transaction(() =>
      interruptRunningRuns(ledger.db, context.now())
    );
    takeover = { previous: acquired.takeover, interruptedRuns: interrupted };
    context.stdout(
      `前の実行のロックが途絶えていたため、引き継ぎました(保持者 ${acquired.takeover.holder})。`
    );
  }
  return { lock, takeover, stopHeartbeat };
};
