import type { Database } from 'bun:sqlite';
import type { ErrorCode } from '@file-seiri/core';
import { formatTimestamp } from './time.ts';

export type ErrorRecord = {
  errorId: number;
  runId: number;
  sourceFileId: number | null;
  /** 読むときは、文字列。新しい版が足したコードも、そのまま読めるようにするため */
  code: string;
  detail: string;
  occurredAt: string;
};

const COLUMNS = `error_id AS errorId, run_id AS runId, source_file_id AS sourceFileId, code, detail,
  occurred_at AS occurredAt`;

/** エラーを記録する(エラー一覧の元)。コードは、`core` の `ErrorCode` */
export const recordError = (
  db: Database,
  input: {
    runId: number;
    sourceFileId?: number;
    code: ErrorCode;
    detail?: string;
    occurredAt: Date;
  }
): number => {
  const result = db
    .query(
      'INSERT INTO errors (run_id, source_file_id, code, detail, occurred_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      input.runId,
      input.sourceFileId ?? null,
      input.code,
      input.detail ?? '',
      formatTimestamp(input.occurredAt)
    );
  return Number(result.lastInsertRowid);
};

/** 実行ごとのエラー(古い順) */
export const listErrors = (db: Database, runId: number): ErrorRecord[] =>
  db
    .query<ErrorRecord, [number]>(
      `SELECT ${COLUMNS} FROM errors WHERE run_id = ? ORDER BY error_id`
    )
    .all(runId);

/** 実行ごとの、コード別の件数 */
export const countErrorsByCode = (
  db: Database,
  runId: number
): Record<string, number> => {
  const rows = db
    .query<{ code: string; count: number }, [number]>(
      'SELECT code, count(*) AS count FROM errors WHERE run_id = ? GROUP BY code'
    )
    .all(runId);
  return Object.fromEntries(rows.map((row) => [row.code, row.count]));
};
