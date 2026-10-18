import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { join } from 'node:path';

export type SpotCheckResult = {
  /** この実行で、ライブラリに入ったファイルの数 */
  candidates: number;
  /** 読み直して、照合した数 */
  checked: number;
  matched: number;
  problems: { relPath: string; detail: string }[];
  bytesRead: number;
  stopped: boolean;
};

/** 抜き取る数: 2%(切り上げ)。ただし、5 件以上・100 件以下(少ないときは、全件) */
export const spotCheckCount = (candidates: number): number =>
  Math.min(
    candidates,
    Math.min(100, Math.max(5, Math.ceil(candidates * 0.02)))
  );

/**
 * 取り込みの最後に、この実行でコピーしたファイルの一部を、ライブラリから読み直して、台帳のハッシュと照合する。
 * コピーのたびの照合(`copyVerified`)とは別に、書き終えたあとの、ドライブの上の状態を、もう一度確かめる
 * (抜き差し・書き込みの遅れで、あとから壊れていないかの、ごく簡単な確認)。全件の照合は、`seiri verify`。
 * `random` は、0 以上 1 未満の乱数(テストで差し替える)。
 */
export const spotCheck = async (environment: {
  db: Database;
  libraryRoot: string;
  runId: number;
  hashFile: (path: string) => Promise<string>;
  random: () => number;
  shouldStop: () => boolean;
}): Promise<SpotCheckResult> => {
  const rows = environment.db
    .query<{ relPath: string; hash: string; sizeBytes: number }, [number]>(
      `SELECT f.rel_path AS relPath, c.hash AS hash, c.size_bytes AS sizeBytes
       FROM library_files AS f JOIN contents AS c ON c.content_id = f.content_id
       WHERE f.run_id = ? ORDER BY f.library_file_id`
    )
    .all(environment.runId);
  const result: SpotCheckResult = {
    candidates: rows.length,
    checked: 0,
    matched: 0,
    problems: [],
    bytesRead: 0,
    stopped: false,
  };
  // 無作為に、必要な数だけ選ぶ(部分的なシャッフル)
  const pool = [...rows];
  const picked: typeof rows = [];
  const count = spotCheckCount(rows.length);
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(environment.random() * pool.length);
    picked.push(...pool.splice(index, 1));
  }
  for (const row of picked) {
    if (environment.shouldStop()) {
      result.stopped = true;
      break;
    }
    const path = join(environment.libraryRoot, row.relPath);
    result.checked += 1;
    try {
      const size = statSync(path).size;
      if (size !== row.sizeBytes) {
        result.problems.push({
          relPath: row.relPath,
          detail: `大きさが、台帳と違います(台帳 ${row.sizeBytes} B / 実際 ${size} B)`,
        });
        continue;
      }
      const hash = await environment.hashFile(path);
      result.bytesRead += size;
      if (hash === row.hash) result.matched += 1;
      else
        result.problems.push({
          relPath: row.relPath,
          detail: 'ハッシュが、台帳と違います(書き終えたあとに、変わりました)',
        });
    } catch (error) {
      result.problems.push({
        relPath: row.relPath,
        detail: `読み直せませんでした: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return result;
};
