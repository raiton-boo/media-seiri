import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './time.ts';

export type RunStatus = 'running' | 'completed' | 'interrupted' | 'failed';

export type Run = {
  runId: number;
  sourceVolumeId: number;
  isDryRun: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  revisionAfter: number | null;
};

export type RunInput = {
  sourceVolumeId: number;
  /** true なら、集計に含めない(`er.md` §3-3) */
  isDryRun: boolean;
  startedAt: Date;
};

export type RunFinish = {
  status: Exclude<RunStatus, 'running'>;
  finishedAt: Date;
  /** 実行後の台帳リビジョン */
  revisionAfter?: number;
};

type RunRow = Omit<Run, 'isDryRun'> & { isDryRun: number };

const COLUMNS = `run_id AS runId, source_volume_id AS sourceVolumeId, is_dry_run AS isDryRun,
  status, started_at AS startedAt, finished_at AS finishedAt, revision_after AS revisionAfter`;

const toRun = (row: RunRow): Run => ({ ...row, isDryRun: row.isDryRun === 1 });

/** 実行を始める(状態は `running`)。実行の ID を返す */
export const startRun = (db: Database, input: RunInput): number => {
  const result = db
    .query(
      'INSERT INTO runs (source_volume_id, is_dry_run, started_at) VALUES (?, ?, ?)'
    )
    .run(
      input.sourceVolumeId,
      input.isDryRun ? 1 : 0,
      formatTimestamp(input.startedAt)
    );
  return Number(result.lastInsertRowid);
};

/** 実行を終える(完了・中断・失敗) */
export const finishRun = (
  db: Database,
  runId: number,
  finish: RunFinish
): void => {
  const result = db
    .query(
      `UPDATE runs SET status = ?, finished_at = ?, revision_after = ? WHERE run_id = ?`
    )
    .run(
      finish.status,
      formatTimestamp(finish.finishedAt),
      finish.revisionAfter ?? null,
      runId
    );
  if (result.changes === 0) throw new Error(`実行がありません: ${runId}`);
};

export const getRun = (db: Database, runId: number): Run | undefined => {
  const row = db
    .query<RunRow, [number]>(`SELECT ${COLUMNS} FROM runs WHERE run_id = ?`)
    .get(runId);
  return row ? toRun(row) : undefined;
};

/** 終わっていない実行(`running`・`interrupted`)。新しい順。同じコマンドで再開するために探す */
export const listUnfinishedRuns = (
  db: Database,
  sourceVolumeId: number
): Run[] =>
  db
    .query<RunRow, [number]>(
      `SELECT ${COLUMNS} FROM runs
       WHERE source_volume_id = ? AND status IN ('running', 'interrupted')
       ORDER BY run_id DESC`
    )
    .all(sourceVolumeId)
    .map(toRun);
