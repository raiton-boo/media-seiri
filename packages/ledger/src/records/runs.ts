import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './time.ts';

export type RunStatus = 'running' | 'completed' | 'interrupted' | 'failed';

/** 実行の種類: 取り込み / ライブラリの再照合(`verify`) */
export type RunKind = 'ingest' | 'verify';

export type Run = {
  runId: number;
  kind: RunKind;
  sourceVolumeId: number;
  isDryRun: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  revisionAfter: number | null;
};

export type RunInput = {
  /** 既定は、取り込み */
  kind?: RunKind;
  /** 検査(`verify`)では、検査するライブラリのボリューム */
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

const COLUMNS = `run_id AS runId, kind, source_volume_id AS sourceVolumeId, is_dry_run AS isDryRun,
  status, started_at AS startedAt, finished_at AS finishedAt, revision_after AS revisionAfter`;

const toRun = (row: RunRow): Run => ({ ...row, isDryRun: row.isDryRun === 1 });

/** 実行を始める(状態は `running`)。実行の ID を返す */
export const startRun = (db: Database, input: RunInput): number => {
  const result = db
    .query(
      'INSERT INTO runs (kind, source_volume_id, is_dry_run, started_at) VALUES (?, ?, ?, ?)'
    )
    .run(
      input.kind ?? 'ingest',
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

/** 終わっていない取り込みの実行(`running`・`interrupted`。検査は、含めない)。新しい順。再開するために探す */
export const listUnfinishedRuns = (
  db: Database,
  sourceVolumeId: number
): Run[] =>
  db
    .query<RunRow, [number]>(
      `SELECT ${COLUMNS} FROM runs
       WHERE source_volume_id = ? AND kind = 'ingest' AND status IN ('running', 'interrupted')
       ORDER BY run_id DESC`
    )
    .all(sourceVolumeId)
    .map(toRun);

/**
 * 中断した実行を、再開する(同じ実行 ID を続ける)。状態を `running` に戻し、終了時刻を消す。
 * 本実行(dry-run でない)の、`interrupted` か `running` だけが対象。それ以外は、エラー。
 */
export const resumeRun = (db: Database, runId: number): void => {
  const result = db
    .query(
      `UPDATE runs SET status = 'running', finished_at = NULL
       WHERE run_id = ? AND kind = 'ingest' AND is_dry_run = 0 AND status IN ('interrupted', 'running')`
    )
    .run(runId);
  if (result.changes === 0) {
    throw new Error(`再開できる実行ではありません: ${runId}`);
  }
};

/**
 * 実行中のまま残っている本実行(dry-run でない)を、すべて `interrupted` にする。
 * ロックが途絶えて引き継いだとき、前の実行は、異常終了したものとして扱う(仕様書 §12)。中断にした実行の ID を返す。
 */
export const interruptRunningRuns = (
  db: Database,
  finishedAt: Date
): number[] =>
  db
    .query<{ runId: number }, [string]>(
      `UPDATE runs SET status = 'interrupted', finished_at = ?
       WHERE status = 'running' AND is_dry_run = 0 RETURNING run_id AS runId`
    )
    .all(formatTimestamp(finishedAt))
    .map((row) => row.runId);
