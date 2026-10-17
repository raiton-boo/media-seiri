import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './time.ts';

export type RepairMethod = 'video_remux' | 'metadata_rewrite' | 'image_salvage';

export type RepairAttempt = {
  attemptId: number;
  sourceFileId: number;
  method: RepairMethod;
  isSuccess: boolean;
  /** 修復で作った、別ファイル(`repaired/`)のパス */
  outputPath: string | null;
  detail: string;
  attemptedAt: string;
};

type RepairAttemptRow = Omit<RepairAttempt, 'isSuccess'> & {
  isSuccess: number;
};

const COLUMNS = `attempt_id AS attemptId, source_file_id AS sourceFileId, method,
  is_success AS isSuccess, output_path AS outputPath, detail, attempted_at AS attemptedAt`;

const toAttempt = (row: RepairAttemptRow): RepairAttempt => ({
  ...row,
  isSuccess: row.isSuccess === 1,
});

/** 修復の試行を記録する(手順・成否・出力先・理由)。ID を返す */
export const recordRepairAttempt = (
  db: Database,
  input: {
    sourceFileId: number;
    method: RepairMethod;
    isSuccess: boolean;
    outputPath?: string;
    detail?: string;
    attemptedAt: Date;
  }
): number => {
  const result = db
    .query(
      `INSERT INTO repair_attempts
         (source_file_id, method, is_success, output_path, detail, attempted_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.sourceFileId,
      input.method,
      input.isSuccess ? 1 : 0,
      input.outputPath ?? null,
      input.detail ?? '',
      formatTimestamp(input.attemptedAt)
    );
  return Number(result.lastInsertRowid);
};

/** ファイルごとの、試した手順(古い順) */
export const listRepairAttempts = (
  db: Database,
  sourceFileId: number
): RepairAttempt[] =>
  db
    .query<RepairAttemptRow, [number]>(
      `SELECT ${COLUMNS} FROM repair_attempts WHERE source_file_id = ? ORDER BY attempt_id`
    )
    .all(sourceFileId)
    .map(toAttempt);

/** 実行ごとの、すべての試行(古い順)。エラー一覧に、試した手順を添えるのに使う */
export const listRepairAttemptsByRun = (
  db: Database,
  runId: number
): RepairAttempt[] =>
  db
    .query<RepairAttemptRow, [number]>(
      `SELECT ${COLUMNS} FROM repair_attempts
       WHERE source_file_id IN (SELECT source_file_id FROM source_files WHERE run_id = ?)
       ORDER BY attempt_id`
    )
    .all(runId)
    .map(toAttempt);
