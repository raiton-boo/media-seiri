import {
  type EventRecord,
  getLatestRun,
  getRun,
  levelsAtLeast,
  listEvents,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import {
  formatEventLine,
  formatEventLineFancy,
  formatLocalTime,
} from '../log/format.ts';
import { openLibraryReadOnly } from '../log/open.ts';
import { showReport } from '../present/index.ts';
import { describeRunKind, STATUS_LABELS } from './status.ts';

export type LogsArguments = {
  library: string | undefined;
  run: string | undefined;
  level: string | undefined;
  verbose: boolean;
  quiet: boolean;
  tail: string | undefined;
  follow: boolean;
};

type Level = EventRecord['level'];
const LEVELS: readonly Level[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
/** 追いかけで、新しいイベントを探す間隔(ミリ秒) */
const FOLLOW_INTERVAL_MS = 1000;

const parsePositiveInteger = (text: string, option: string): number => {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0)
    throw new CliError(
      `${option} には、1 以上の整数を指定してください: ${text}`
    );
  return value;
};

/** 表示するレベル(以上)。既定は INFO。`--verbose` で DEBUG、`--quiet` で WARN(`cli-logging.md` §5) */
const resolveLevel = (args: LogsArguments): Level => {
  const chosen = [args.level !== undefined, args.verbose, args.quiet].filter(
    Boolean
  ).length;
  if (chosen > 1)
    throw new CliError(
      '--level・--verbose・--quiet は、どれか 1 つだけ指定できます。'
    );
  if (args.verbose) return 'DEBUG';
  if (args.quiet) return 'WARN';
  if (args.level === undefined) return 'INFO';
  const level = args.level.toUpperCase();
  if (!(LEVELS as readonly string[]).includes(level)) {
    throw new CliError(
      `--level が正しくありません: ${args.level}(${LEVELS.join(' / ')} のどれか)`
    );
  }
  return level as Level;
};

/**
 * `file-seiri logs [--run <ID>] [--level <レベル>] [--verbose|--quiet] [--tail <N>] [--follow]`
 * 実行のログ(台帳のイベント)を、古い順に表示する(`cli-logging.md` §7)。既定は、直近の実行・INFO 以上。
 * 台帳は、読み取り専用で開く。`--follow` は、実行中のログを、追いかけて表示し、実行が終わったら終了する(Ctrl-C でも、終了する)。
 */
export const logsCommand = async (
  context: CommandContext,
  args: LogsArguments
): Promise<ExitCode> => {
  const minLevel = resolveLevel(args);
  const tail =
    args.tail === undefined
      ? undefined
      : parsePositiveInteger(args.tail, '--tail');
  const requestedRun =
    args.run === undefined
      ? undefined
      : parsePositiveInteger(args.run, '--run');

  const { ledger } = openLibraryReadOnly(context, args.library);
  try {
    const { db } = ledger;
    const run =
      requestedRun === undefined ? getLatestRun(db) : getRun(db, requestedRun);
    if (!run) {
      if (requestedRun !== undefined)
        throw new CliError(`実行 ${requestedRun} が見つかりません。`);
      context.stdout('実行の記録がありません。');
      return EXIT_CODES.ok;
    }

    const shown = new Set<string>(levelsAtLeast(minLevel));
    const style = { timeZone: context.timeZone, color: context.useColor };
    const print = (events: readonly EventRecord[]): void => {
      for (const event of events)
        if (shown.has(event.level))
          context.stdout(
            context.fancy
              ? formatEventLineFancy(event, context.timeZone)
              : formatEventLine(event, style)
          );
    };
    if (context.fancy) {
      showReport(context, {
        title: 'ログ',
        badge: {
          label: STATUS_LABELS[run.status],
          tone:
            run.status === 'completed'
              ? 'ok'
              : run.status === 'running'
                ? 'info'
                : 'warn',
        },
        sections: [
          {
            title: `実行 #${run.runId}`,
            tone: 'info',
            rows: [
              { label: '種類', value: describeRunKind(run) },
              {
                label: '開始',
                value: formatLocalTime(run.startedAt, context.timeZone),
              },
              { label: '表示', value: `${minLevel} 以上` },
            ],
          },
        ],
      });
    }

    // イベントは、すべてのレベルで読み、表示で絞る(追いかけの続きの位置を、見落とさないため)
    let events = listEvents(db, { runId: run.runId });
    let cursor = events.at(-1)?.eventId ?? 0;
    const visible = events.filter((event) => shown.has(event.level));
    print(tail === undefined ? visible : visible.slice(-tail));
    if (!args.follow) return EXIT_CODES.ok;

    // 追いかけ: 新しいイベントを、一定の間隔で探す。実行が終わったら、最後の分を読んで、終了する
    for (;;) {
      if (getRun(db, run.runId)?.status !== 'running') {
        events = listEvents(db, { runId: run.runId, afterEventId: cursor });
        print(events);
        return EXIT_CODES.ok;
      }
      if (context.shouldStop()) return EXIT_CODES.ok;
      await context.sleep(FOLLOW_INTERVAL_MS);
      events = listEvents(db, { runId: run.runId, afterEventId: cursor });
      if (events.length > 0) {
        cursor = events.at(-1)?.eventId ?? cursor;
        print(events);
      }
    }
  } finally {
    ledger.close();
  }
};
