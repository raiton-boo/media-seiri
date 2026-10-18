import {
  countErrorsByCode,
  countSourceFilesByState,
  getVolume,
  INGEST_LOCK_NAME,
  isLockStale,
  LOCK_CONFIG,
  listEvents,
  listRecentRuns,
  type Run,
  readLock,
} from '@file-seiri/ledger';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { formatEventLine, formatLocalTime } from '../log/format.ts';
import { openLibraryReadOnly } from '../log/open.ts';

const STATUS_LABELS: Record<Run['status'], string> = {
  running: '実行中',
  completed: '完了',
  interrupted: '中断',
  failed: '失敗',
};

/** 実行の種類の表示: 取り込み / 取り込み(dry-run) / 検査 */
export const describeRunKind = (run: Pick<Run, 'kind' | 'isDryRun'>): string =>
  run.kind === 'verify'
    ? '検査'
    : run.isDryRun
      ? '取り込み(dry-run)'
      : '取り込み';

const RECENT_RUNS = 5;

/**
 * `file-seiri status`: 現在の実行の状況と、ロックの保持者を表示する(`cli-logging.md` §7)。
 * 台帳は、読み取り専用で開く(取り込み中でも、見られる)。
 */
export const statusCommand = (
  context: CommandContext,
  libraryOption: string | undefined
): ExitCode => {
  const { root, libraryId, ledger } = openLibraryReadOnly(
    context,
    libraryOption
  );
  try {
    const { db } = ledger;
    const time = (iso: string): string =>
      formatLocalTime(iso, context.timeZone);
    context.stdout(`ライブラリ: ${libraryId.slice(0, 8)}  ${root}`);

    const lock = readLock(db, INGEST_LOCK_NAME);
    if (!lock) {
      context.stdout('ロック: なし(書き込み中の実行は、ありません)');
    } else {
      const seconds = Math.max(
        0,
        Math.round(
          (context.now().getTime() - Date.parse(lock.heartbeatAt)) / 1000
        )
      );
      const stale = isLockStale(lock.heartbeatAt, context.now());
      context.stdout(`ロック: 保持者 ${lock.holder}`);
      context.stdout(
        `  開始 ${time(lock.acquiredAt)}、最後の生存通知 ${time(lock.heartbeatAt)}(${seconds} 秒前)`
      );
      if (stale) {
        context.stdout(
          `  生存通知が ${LOCK_CONFIG.staleAfterMs / 1000} 秒以上途絶えています(異常終了した可能性があります。次の実行が、自動で引き継ぎます)`
        );
      }
    }

    const runs = listRecentRuns(db, RECENT_RUNS);
    const [latest] = runs;
    if (!latest) {
      context.stdout('実行: まだ記録がありません');
      return EXIT_CODES.ok;
    }
    const volume = getVolume(db, latest.sourceVolumeId);
    context.stdout('');
    context.stdout(
      `直近の実行: #${latest.runId} ${describeRunKind(latest)}  ${STATUS_LABELS[latest.status]}  開始 ${time(latest.startedAt)}${latest.finishedAt ? `  終了 ${time(latest.finishedAt)}` : ''}`
    );
    context.stdout(
      `  ${latest.kind === 'verify' ? '対象' : 'ソース'}: ${volume?.label || volume?.volumeUuid || '(不明)'}`
    );
    const states = Object.entries(countSourceFilesByState(db, latest.runId));
    if (states.length > 0)
      context.stdout(
        `  ファイル: ${states.map(([state, count]) => `${state} ${count}`).join(' / ')}`
      );
    const errors = Object.entries(countErrorsByCode(db, latest.runId));
    const errorTotal = errors.reduce((sum, [, count]) => sum + count, 0);
    context.stdout(
      `  エラー: ${errorTotal} 件${errors.length > 0 ? `(${errors.map(([code, count]) => `${code} ${count}`).join(' / ')})` : ''}`
    );
    const last = listEvents(db, { runId: latest.runId, minLevel: 'INFO' }).at(
      -1
    );
    if (last)
      context.stdout(
        `  最後のイベント: ${formatEventLine(last, { timeZone: context.timeZone, color: false })}`
      );
    if (latest.status === 'running' && !lock) {
      context.stdout(
        '  ※ 実行中のままですが、ロックがありません(異常終了した可能性があります。次の本実行が、中断として記録します)'
      );
    }

    if (runs.length > 1) {
      context.stdout('');
      context.stdout('最近の実行:');
      for (const run of runs) {
        context.stdout(
          `  #${run.runId} ${describeRunKind(run)}  ${STATUS_LABELS[run.status]}  ${time(run.startedAt)}`
        );
      }
    }
    return EXIT_CODES.ok;
  } finally {
    ledger.close();
  }
};
