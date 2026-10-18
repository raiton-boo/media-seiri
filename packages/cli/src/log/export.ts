import type { Database } from 'bun:sqlite';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEvents } from '@file-seiri/ledger';
import { libraryWorkDir } from '../config/paths.ts';
import { formatEventLine } from './format.ts';

/** ログファイルの置き場所: `data/libraries/<ID>/logs/run-<実行 ID>.log`(仕様書 §8-1) */
export const runLogPath = (
  dataDir: string,
  libraryId: string,
  runId: number
): string =>
  join(libraryWorkDir(dataDir, libraryId), 'logs', `run-${runId}.log`);

/**
 * 実行のイベントを、すべて(DEBUG を含む)、ログファイルに書き出す(要件 L-02)。実行ごとに 1 ファイル。
 * 一時ファイルに書いてから、名前を付け替える(途中で止まっても、前のログが残る)。
 * 再開した実行は、全体を書き直す(前の分も含む)。書き込んだパスを返す。
 */
export const exportRunLog = (input: {
  db: Database;
  dataDir: string;
  libraryId: string;
  runId: number;
  timeZone: string;
}): string => {
  const path = runLogPath(input.dataDir, input.libraryId, input.runId);
  mkdirSync(join(path, '..'), { recursive: true });
  const lines = listEvents(input.db, { runId: input.runId }).map((event) =>
    formatEventLine(event, { timeZone: input.timeZone, color: false })
  );
  const temporaryPath = `${path}.tmp`;
  writeFileSync(
    temporaryPath,
    lines.length === 0 ? '' : `${lines.join('\n')}\n`
  );
  renameSync(temporaryPath, path);
  return path;
};
