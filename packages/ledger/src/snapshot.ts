import { Database } from 'bun:sqlite';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { LedgerError } from './errors.ts';
import { type Ledger, openLedger } from './ledger.ts';
import { getRevision } from './meta.ts';
import { formatTimestamp } from './records/time.ts';

/** スナップショットを置く、ライブラリの根の下のフォルダ(仕様書 §8-2) */
export const SNAPSHOT_DIRECTORY = '.file-seiri';
export const SNAPSHOT_FILE_NAME = 'catalog.snapshot.sqlite';

/** ライブラリの根からの、スナップショットのパス */
export const snapshotPathOf = (libraryRoot: string): string =>
  join(libraryRoot, SNAPSHOT_DIRECTORY, SNAPSHOT_FILE_NAME);

/** SQLite の、付属のファイル(WAL・共有メモリ)の名前の末尾 */
const SIDE_FILE_SUFFIXES = ['-wal', '-shm'] as const;

const removeIfExists = (path: string): void => rmSync(path, { force: true });

/** `VACUUM INTO` で作った一時ファイルを、スナップショットの形に整える。リビジョンを返す */
const finalizeSnapshotCopy = (path: string): number => {
  const copy = new Database(path, { strict: true });
  try {
    copy.exec('PRAGMA journal_mode = DELETE');
    copy.exec('DELETE FROM locks');
    return getRevision(copy);
  } finally {
    copy.close();
  }
};

/**
 * 台帳のスナップショットを保存する(`VACUUM INTO`)。保存した時点のリビジョンを返す。
 *
 * - WAL ではない形式(`journal_mode = DELETE`)で保存する。WAL のファイルは、読み取り専用のフォルダや、
 *   読み取り専用のドライブでは開けないため(実測。`docs/er.md` §6)。
 * - `locks` は空にする。スナップショットから復元したときに、前の実行のロックが残らないようにする。
 * - 一時ファイルに作ってから、名前を付け替える(途中で止まっても、前のスナップショットは壊れない)。
 * - トランザクションの外で呼ぶ(`VACUUM` は、トランザクションの中では動かない)。
 */
export const createSnapshot = (
  ledger: Ledger,
  snapshotPath: string
): { revision: number } => {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.tmp`;
  removeIfExists(temporaryPath);
  for (const suffix of SIDE_FILE_SUFFIXES) {
    removeIfExists(`${temporaryPath}${suffix}`);
  }

  try {
    ledger.db.query('VACUUM INTO ?').run(temporaryPath);
    const revision = finalizeSnapshotCopy(temporaryPath);
    renameSync(temporaryPath, snapshotPath);
    return { revision };
  } catch (error) {
    removeIfExists(temporaryPath);
    throw error;
  }
};

export type SnapshotStatus =
  | { kind: 'no-snapshot' }
  // 作業用の台帳がない(この Mac の `data/` を失った)。スナップショットから復元できる
  | { kind: 'working-missing'; snapshotRevision: number }
  | { kind: 'in-sync'; workingRevision: number; snapshotRevision: number }
  | { kind: 'working-newer'; workingRevision: number; snapshotRevision: number }
  // スナップショットのほうが新しい。利用者に確認する。自動で上書きしない(仕様書 §8-2)
  | {
      kind: 'snapshot-newer';
      workingRevision: number;
      snapshotRevision: number;
    };

const readRevision = (path: string, libraryId: string | undefined): number => {
  const ledger = openLedger(path, { mode: 'readonly', libraryId });
  try {
    return getRevision(ledger.db);
  } finally {
    ledger.close();
  }
};

/**
 * 作業用の台帳と、スナップショットの、リビジョンを比べる(起動時に呼ぶ)。何も書き換えない。
 * `libraryId` を渡すと、別のライブラリの台帳を取り違えていないかも確かめる(違えば、エラー)。
 */
export const compareWithSnapshot = (input: {
  workingPath: string;
  snapshotPath: string;
  libraryId?: string;
}): SnapshotStatus => {
  if (!existsSync(input.snapshotPath)) return { kind: 'no-snapshot' };
  const snapshotRevision = readRevision(input.snapshotPath, input.libraryId);
  if (!existsSync(input.workingPath)) {
    return { kind: 'working-missing', snapshotRevision };
  }
  const workingRevision = readRevision(input.workingPath, input.libraryId);
  const kind =
    snapshotRevision > workingRevision
      ? 'snapshot-newer'
      : snapshotRevision < workingRevision
        ? 'working-newer'
        : 'in-sync';
  return { kind, workingRevision, snapshotRevision };
};

/**
 * スナップショットから、作業用の台帳を復元する。
 * 作業用の台帳が、すでにあるときは、`confirmed: true`(利用者が確認した)のときだけ置き換える。
 * 置き換える前の台帳は、消さずに、`<台帳>.replaced-<時刻>` へ移す。
 */
export const restoreFromSnapshot = (input: {
  snapshotPath: string;
  workingPath: string;
  libraryId?: string;
  confirmed: boolean;
  now: Date;
}): { restoredRevision: number; backupPath: string | undefined } => {
  const restoredRevision = readRevision(input.snapshotPath, input.libraryId);
  const workingExists = existsSync(input.workingPath);
  if (workingExists && !input.confirmed) {
    throw new LedgerError(
      'SNAPSHOT_CONFIRMATION_REQUIRED',
      '作業用の台帳を、スナップショットで置き換えるには、利用者の確認が必要です'
    );
  }

  mkdirSync(dirname(input.workingPath), { recursive: true });
  const temporaryPath = `${input.workingPath}.restoring`;
  removeIfExists(temporaryPath);
  copyFileSync(input.snapshotPath, temporaryPath);

  let backupPath: string | undefined;
  if (workingExists) {
    // `:` は、ファイル名に向かない環境があるため、使わない
    const stamp = formatTimestamp(input.now).replaceAll(':', '-');
    backupPath = `${input.workingPath}.replaced-${stamp}`;
    renameSync(input.workingPath, backupPath);
  }
  // 古い台帳の WAL が残ると、復元した台帳に、混ざる。移すか、消す
  for (const suffix of SIDE_FILE_SUFFIXES) {
    const side = `${input.workingPath}${suffix}`;
    if (!existsSync(side)) continue;
    if (backupPath) renameSync(side, `${backupPath}${suffix}`);
    else removeIfExists(side);
  }
  renameSync(temporaryPath, input.workingPath);
  return { restoredRevision, backupPath };
};
