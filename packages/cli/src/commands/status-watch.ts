import {
  getRunningProgress,
  INGEST_LOCK_NAME,
  listEvents,
  listRecentRuns,
  type RunningProgress,
  readLock,
} from '@file-seiri/ledger';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { formatBytes } from '../ingest/preflight.ts';
import { formatElapsed } from '../ingest/summary.ts';
import { formatEventLine, formatLocalTime } from '../log/format.ts';
import { openLibraryReadOnly } from '../log/open.ts';
import { showReport } from '../present/index.ts';

/** 画面に出す、直近のログの数 */
const RECENT_LOGS = 8;
const CLEAR_SCREEN = '\u001b[2J\u001b[H';

type Tick = {
  running: RunningProgress | undefined;
  lockHolder: string | undefined;
  latest: { runId: number; status: string; startedAt: string } | undefined;
  logs: string[];
};

const percentOf = (running: RunningProgress): number =>
  running.total === 0
    ? 0
    : Math.min(100, Math.round((running.done / running.total) * 100));

/** 1 回分の、台帳の読み取り(毎回、開き直す。取り込みの書き込みを、止めない) */
const readTick = async (
  context: CommandContext,
  libraryOption: string | undefined
): Promise<Tick> => {
  const { ledger } = await openLibraryReadOnly(context, libraryOption);
  try {
    const { db } = ledger;
    const running = getRunningProgress(db);
    const [latest] = listRecentRuns(db, 1);
    const target = running?.runId ?? latest?.runId;
    const logs =
      target === undefined
        ? []
        : listEvents(db, { runId: target, minLevel: 'INFO' })
            .slice(-RECENT_LOGS)
            .map((event) =>
              formatEventLine(event, {
                timeZone: context.timeZone,
                color: false,
              })
            );
    return {
      running,
      lockHolder: readLock(db, INGEST_LOCK_NAME)?.holder,
      latest: latest
        ? {
            runId: latest.runId,
            status: latest.status,
            startedAt: latest.startedAt,
          }
        : undefined,
      logs,
    };
  } finally {
    ledger.close();
  }
};

const plainLine = (context: CommandContext, tick: Tick): string => {
  const at = formatLocalTime(
    context.now().toISOString(),
    context.timeZone
  ).slice(11);
  if (!tick.running) return `[${at}] 実行中の取り込みは、ありません(待機中)`;
  const r = tick.running;
  return `[${at}] 実行 #${r.runId} ${r.sourceLabel ?? ''}: ${r.done}/${r.total} ファイル(${percentOf(r)}%)・採用 ${r.adopted}・重複 ${r.duplicates}・エラー ${r.errors}・コピー ${formatBytes(r.copiedBytes)}/${formatBytes(r.plannedBytes)}`;
};

const showTick = (context: CommandContext, tick: Tick): void => {
  const running = tick.running;
  showReport(context, {
    title: '実行の見張り',
    badge: running
      ? { label: `実行中 #${running.runId}`, tone: 'info' }
      : { label: '待機中', tone: 'dim' },
    sections: [
      running
        ? {
            title: running.sourceLabel ?? '取り込み',
            tone: 'info',
            rows: [
              {
                label: '進み具合',
                value: `${running.done.toLocaleString('en-US')} / ${running.total.toLocaleString('en-US')} ファイル(${percentOf(running)}%)`,
                ratio: running.total === 0 ? 0 : running.done / running.total,
                tone: 'ok',
              },
              {
                label: 'コピー',
                value: `${formatBytes(running.copiedBytes)} / ${formatBytes(running.plannedBytes)}`,
                ratio:
                  running.plannedBytes === 0
                    ? 0
                    : running.copiedBytes / running.plannedBytes,
              },
              { label: '採用', value: String(running.adopted) },
              { label: '重複', value: String(running.duplicates) },
              {
                label: '日付フォールバック',
                value: String(running.dateFallback),
              },
              {
                label: 'エラー',
                value: String(running.errors),
                tone: running.errors > 0 ? 'error' : undefined,
              },
              {
                label: '経過',
                value: formatElapsed(
                  context.now().getTime() - Date.parse(running.startedAt)
                ),
                tone: 'dim',
              },
            ],
          }
        : {
            title: '待機中',
            tone: 'dim',
            rows: [
              {
                label: '状態',
                value: tick.latest
                  ? `いま、実行中の取り込みは、ありません(直近: #${tick.latest.runId} ${tick.latest.status})`
                  : 'まだ、実行の記録が、ありません',
                tone: 'dim',
              },
            ],
          },
      ...(tick.logs.length > 0
        ? [{ title: '直近のログ', tone: 'dim' as const, lines: tick.logs }]
        : []),
    ],
    hint: '終わるときは、Ctrl-C(取り込みが終わると、自動で終わります)',
  });
};

/**
 * `status --watch [--interval <秒>]`: 実行中の取り込みを、見張る(別のウィンドウから)。
 * 進み具合・件数・直近のログを、一定の間隔で、更新して出す。実行中のものがなければ、始まるまで待つ。
 * 見張っていた実行が終われば、最後の様子を出して、終わる。Ctrl-C でも、終わる。
 * 台帳は、読み取りだけで、毎回、開き直す(取り込みを、止めない)。
 */
export const statusWatch = async (
  context: CommandContext,
  libraryOption: string | undefined,
  intervalSeconds: number
): Promise<ExitCode> => {
  let watched: number | undefined;
  let lastLine = '';
  for (;;) {
    const tick = await readTick(context, libraryOption);
    if (tick.running) watched = tick.running.runId;
    if (context.fancy) {
      context.stdout(CLEAR_SCREEN);
      showTick(context, tick);
    } else {
      // 端末でないときは、変わったときだけ、1 行ずつ追記する
      const line = plainLine(context, tick).replace(/^\[[^\]]*\] /, '');
      if (line !== lastLine) context.stdout(plainLine(context, tick));
      lastLine = line;
    }
    // 見張っていた実行が、終わった
    if (watched !== undefined && !tick.running) {
      const final =
        tick.latest?.runId === watched ? tick.latest.status : '終了';
      context.stdout(`\n実行 #${watched} が、終わりました(${final})。`);
      return EXIT_CODES.ok;
    }
    if (context.shouldStop()) return EXIT_CODES.ok;
    await context.sleep(intervalSeconds * 1000);
    if (context.shouldStop()) return EXIT_CODES.ok;
  }
};
