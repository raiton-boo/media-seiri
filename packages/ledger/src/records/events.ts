import type { Database } from 'bun:sqlite';
import type { LogLevel } from '@file-seiri/core';
import { formatTimestamp } from './time.ts';

export type EventRecord = {
  eventId: number;
  runId: number;
  sourceFileId: number | null;
  level: LogLevel;
  code: string;
  message: string;
  occurredAt: string;
};

/** 既定の、1 度に読む件数 */
const DEFAULT_LIMIT = 500;

/** 処理のイベント(逐次ログの元)を記録する */
export const recordEvent = (
  db: Database,
  input: {
    runId: number;
    sourceFileId?: number;
    level: LogLevel;
    code: string;
    message: string;
    occurredAt: Date;
  }
): number => {
  const result = db
    .query(
      `INSERT INTO events (run_id, source_file_id, level, code, message, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      input.sourceFileId ?? null,
      input.level,
      input.code,
      input.message,
      formatTimestamp(input.occurredAt)
    );
  return Number(result.lastInsertRowid);
};

/**
 * `afterEventId` より新しいイベントを、古い順に読む(Web のリアルタイム表示が、続きを読むのに使う)。
 * 最初は、`afterEventId` に 0 を渡す。
 */
export const listEventsAfter = (
  db: Database,
  runId: number,
  afterEventId: number,
  limit = DEFAULT_LIMIT
): EventRecord[] =>
  db
    .query<EventRecord, [number, number, number]>(
      `SELECT event_id AS eventId, run_id AS runId, source_file_id AS sourceFileId, level, code,
         message, occurred_at AS occurredAt
       FROM events WHERE run_id = ? AND event_id > ? ORDER BY event_id LIMIT ?`
    )
    .all(runId, afterEventId, limit);
