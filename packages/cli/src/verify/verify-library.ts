import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { mapConcurrent } from '../ingest/concurrency.ts';
import { listLibraryDiskFiles } from './disk-files.ts';
import { pickSample } from './sample.ts';

/** 検査の対象: 台帳の、ライブラリのファイル 1 つ */
export type LedgerFile = {
  libraryFileId: number;
  relPath: string;
  hash: string;
  sizeBytes: number;
};

export type FileProblem = {
  relPath: string;
  /** 利用者に見せる、理由 */
  detail: string;
};

export type VerifyReport = {
  /** 台帳にある、ライブラリのファイルの数 */
  ledgerFiles: number;
  /** 実際に検査した数(抜き取りのときは、ledgerFiles より少ない) */
  checked: number;
  matched: number;
  /** ハッシュ・サイズが、台帳と違う */
  mismatched: FileProblem[];
  /** 台帳にあるが、ファイルがない */
  missing: FileProblem[];
  /** ファイルはあるが、読めなかった(検査できない) */
  unreadable: FileProblem[];
  /** ファイルはあるが、台帳にない(報告のみ) */
  unregistered: string[];
  /** 読んだバイト数 */
  bytesRead: number;
  /** 中断(Ctrl-C・ロックを失った)で、途中までだった */
  stopped: boolean;
};

export type VerifyEnvironment = {
  db: Database;
  libraryRoot: string;
  /** ファイルを、OS のキャッシュを避けて読み、ハッシュを返す(テストでは、差し替える) */
  hashFile: (path: string) => Promise<string>;
  /** 同時に読む数(HDD は 1、SSD は並列) */
  concurrency: number;
  /** 抜き取りの割合(1 なら、全件) */
  sampleRatio: number;
  random: () => number;
  shouldStop: () => boolean;
  onProgress?: (checked: number, total: number) => void;
};

/** 台帳の、ライブラリのファイル(内容のハッシュ・サイズつき)を、ディスクの順(パスの順)に読む */
export const listLedgerFiles = (db: Database): LedgerFile[] =>
  db
    .query<LedgerFile, []>(
      `SELECT l.library_file_id AS libraryFileId, l.rel_path AS relPath, c.hash AS hash, c.size_bytes AS sizeBytes
       FROM library_files AS l JOIN contents AS c ON c.content_id = l.content_id
       ORDER BY l.rel_path`
    )
    .all();

class StopRequested extends Error {}

const PROGRESS_INTERVAL = 500;
const SHORT_HASH = 12;

/**
 * ライブラリの全ファイルを読み直して、台帳と照合する(`docs/features/hash-verify.md` §6)。何も書き換えない(ファイルも、台帳も)。
 * - 欠落: 台帳にあるが、ファイルがない
 * - 不一致: サイズが違う(ハッシュは、計算しない)、または、ハッシュが違う
 * - 読み取り不可: 読めない(検査できない)
 * - 未登録: ファイルはあるが、台帳にない(台帳の大文字小文字を区別しない比較。exFAT などに合わせる)
 * 抜き取り(`sampleRatio` < 1)のときも、未登録の探索は、全体を調べる(ディレクトリをたどるだけで、軽いため)。
 */
export const verifyLibrary = async (
  environment: VerifyEnvironment
): Promise<VerifyReport> => {
  const { db, libraryRoot } = environment;
  const ledgerFiles = listLedgerFiles(db);
  const targets = pickSample(
    ledgerFiles,
    environment.sampleRatio,
    environment.random
  );
  const report: VerifyReport = {
    ledgerFiles: ledgerFiles.length,
    checked: 0,
    matched: 0,
    mismatched: [],
    missing: [],
    unreadable: [],
    unregistered: [],
    bytesRead: 0,
    stopped: false,
  };

  try {
    await mapConcurrent(targets, environment.concurrency, async (file) => {
      if (environment.shouldStop()) throw new StopRequested();
      const path = join(libraryRoot, file.relPath);
      let size: number;
      try {
        size = statSync(path).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          report.missing.push({
            relPath: file.relPath,
            detail: 'ファイルがありません(台帳には、あります)',
          });
        } else {
          report.unreadable.push({
            relPath: file.relPath,
            detail: `読み取れません: ${(error as Error).message}`,
          });
        }
        report.checked += 1;
        return;
      }
      if (size !== file.sizeBytes) {
        // サイズが違えば、ハッシュも違う。読まずに、不一致とする
        report.mismatched.push({
          relPath: file.relPath,
          detail: `サイズが違います(台帳 ${file.sizeBytes} バイト、実際 ${size} バイト)`,
        });
      } else {
        try {
          const actual = await environment.hashFile(path);
          report.bytesRead += size;
          if (actual === file.hash) report.matched += 1;
          else {
            report.mismatched.push({
              relPath: file.relPath,
              detail: `ハッシュが違います(台帳 ${file.hash.slice(0, SHORT_HASH)}…、実際 ${actual.slice(0, SHORT_HASH)}…)`,
            });
          }
        } catch (error) {
          report.unreadable.push({
            relPath: file.relPath,
            detail: `読み取れません: ${(error as Error).message}`,
          });
        }
      }
      report.checked += 1;
      if (report.checked % PROGRESS_INTERVAL === 0)
        environment.onProgress?.(report.checked, targets.length);
    });
  } catch (error) {
    if (!(error instanceof StopRequested)) throw error;
    report.stopped = true;
  }

  // 未登録: ディスクにあって、台帳にないもの。中断したときは、調べない(結果が、不完全になるため)
  if (!report.stopped) {
    const known = new Set(
      ledgerFiles.map((file) => file.relPath.toLowerCase())
    );
    report.unregistered = listLibraryDiskFiles(libraryRoot).filter(
      (relPath) => !known.has(relPath.toLowerCase())
    );
  }
  // 並行して読んだときの、結果の並びを、パスの順にそろえる
  const byPath = (a: FileProblem, b: FileProblem): number =>
    a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
  report.mismatched.sort(byPath);
  report.missing.sort(byPath);
  report.unreadable.sort(byPath);
  return report;
};
