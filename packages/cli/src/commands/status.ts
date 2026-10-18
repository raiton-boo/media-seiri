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
import { type Report, showReport } from '../present/index.ts';

export const STATUS_LABELS: Record<Run['status'], string> = {
  running: '実行中',
  completed: '完了',
  interrupted: '中断',
  failed: '失敗',
};

/** 実行の種類の表示: 取り込み / 取り込み(dry-run) / 検査 / サムネイル */
export const describeRunKind = (
  run: Pick<Run, 'kind' | 'isDryRun'>
): string => {
  if (run.kind === 'verify') return '検査';
  if (run.kind === 'thumbs') return 'サムネイル';
  return run.isDryRun ? '取り込み(dry-run)' : '取り込み';
};

const RECENT_RUNS = 5;

const STATUS_TONES: Record<Run['status'], 'ok' | 'info' | 'warn' | 'error'> = {
  running: 'info',
  completed: 'ok',
  interrupted: 'warn',
  failed: 'error',
};

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
    if (context.fancy) {
      showReport(context, buildStatusReport(context, { root, libraryId, db }));
      return EXIT_CODES.ok;
    }
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

type StatusSource = {
  root: string;
  libraryId: string;
  db: Parameters<typeof readLock>[0];
};

/** 状況を、色つきの枠にする(文字だけの表示と、同じ内容) */
const buildStatusReport = (
  context: CommandContext,
  { root, libraryId, db }: StatusSource
): Report => {
  const time = (iso: string): string => formatLocalTime(iso, context.timeZone);
  const sections: Report['sections'] = [
    {
      title: 'ライブラリ',
      tone: 'info',
      rows: [
        { label: 'ID', value: libraryId.slice(0, 8) },
        { label: '場所', value: root },
      ],
    },
  ];
  const lock = readLock(db, INGEST_LOCK_NAME);
  if (!lock) {
    sections.push({
      title: 'ロック',
      tone: 'ok',
      rows: [
        {
          label: '状態',
          value: 'なし(書き込み中の実行は、ありません)',
          tone: 'ok',
        },
      ],
    });
  } else {
    const seconds = Math.max(
      0,
      Math.round(
        (context.now().getTime() - Date.parse(lock.heartbeatAt)) / 1000
      )
    );
    const stale = isLockStale(lock.heartbeatAt, context.now());
    sections.push({
      title: 'ロック',
      tone: stale ? 'warn' : 'info',
      rows: [
        { label: '保持者', value: lock.holder },
        { label: '開始', value: time(lock.acquiredAt) },
        {
          label: '生存通知',
          value: `${time(lock.heartbeatAt)}(${seconds} 秒前)`,
          tone: stale ? 'warn' : undefined,
        },
      ],
      lines: stale
        ? [
            `生存通知が ${LOCK_CONFIG.staleAfterMs / 1000} 秒以上途絶えています(異常終了した可能性があります。次の実行が、自動で引き継ぎます)`,
          ]
        : undefined,
    });
  }

  const runs = listRecentRuns(db, RECENT_RUNS);
  const [latest] = runs;
  if (!latest) {
    sections.push({
      title: '実行',
      tone: 'dim',
      rows: [{ label: '状態', value: 'まだ記録がありません', tone: 'dim' }],
    });
    return { title: '状況', sections };
  }
  const volume = getVolume(db, latest.sourceVolumeId);
  const states = Object.entries(countSourceFilesByState(db, latest.runId));
  const errors = Object.entries(countErrorsByCode(db, latest.runId));
  const errorTotal = errors.reduce((sum, [, count]) => sum + count, 0);
  const last = listEvents(db, { runId: latest.runId, minLevel: 'INFO' }).at(-1);
  const latestRows: Report['sections'][number]['rows'] = [
    { label: '種類', value: describeRunKind(latest) },
    {
      label: '状態',
      value: STATUS_LABELS[latest.status],
      tone: STATUS_TONES[latest.status],
    },
    { label: '開始', value: time(latest.startedAt) },
    ...(latest.finishedAt
      ? [{ label: '終了', value: time(latest.finishedAt) }]
      : []),
    {
      label: latest.kind === 'verify' ? '対象' : 'ソース',
      value: volume?.label || volume?.volumeUuid || '(不明)',
    },
    ...(states.length > 0
      ? [
          {
            label: 'ファイル',
            value: states
              .map(([state, count]) => `${state} ${count}`)
              .join(' / '),
          },
        ]
      : []),
    {
      label: 'エラー',
      value: `${errorTotal} 件${errors.length > 0 ? `(${errors.map(([code, count]) => `${code} ${count}`).join(' / ')})` : ''}`,
      tone: errorTotal > 0 ? 'error' : 'ok',
    },
    ...(last
      ? [
          {
            label: '最後のイベント',
            value: formatEventLine(last, {
              timeZone: context.timeZone,
              color: false,
            }),
            tone: 'dim' as const,
          },
        ]
      : []),
  ];
  sections.push({
    title: `直近の実行 #${latest.runId}`,
    tone: STATUS_TONES[latest.status],
    rows: latestRows,
    lines:
      latest.status === 'running' && !lock
        ? [
            '実行中のままですが、ロックがありません(異常終了した可能性があります。次の本実行が、中断として記録します)',
          ]
        : undefined,
  });
  if (runs.length > 1) {
    sections.push({
      title: '最近の実行',
      tone: 'dim',
      table: {
        header: ['実行', '種類', '状態', '開始'],
        rows: runs.map((run) => [
          `#${run.runId}`,
          describeRunKind(run),
          STATUS_LABELS[run.status],
          time(run.startedAt),
        ]),
      },
    });
  }
  return { title: '状況', sections };
};
