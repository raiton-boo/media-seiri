import type { Database } from 'bun:sqlite';
import {
  getRunSummary,
  RUN_SUMMARY_SQL,
  type RunSummary,
  type RunSummaryRow,
  toRunSummary,
} from './dashboard.ts';

/** 実行履歴の絞り込み: すべて / 通常(dry-run でない)/ dry-run / 中断 */
export type RunFilter = 'all' | 'normal' | 'dry-run' | 'interrupted';

const WHERE: Record<RunFilter, string> = {
  all: '',
  normal: 'WHERE r.is_dry_run = 0',
  'dry-run': 'WHERE r.is_dry_run = 1',
  interrupted: "WHERE r.status = 'interrupted'",
};

/** 実行の一覧(新しい順)と、絞り込みに合う全件数 */
export const browseRuns = (
  db: Database,
  filter: RunFilter,
  page: { limit: number; offset: number }
): { total: number; items: RunSummary[] } => ({
  total:
    db
      .query<{ n: number }, []>(
        `SELECT count(*) AS n FROM runs AS r ${WHERE[filter]}`
      )
      .get()?.n ?? 0,
  items: db
    .query<RunSummaryRow, [number, number]>(
      `${RUN_SUMMARY_SQL} ${WHERE[filter]} ORDER BY r.run_id DESC LIMIT ? OFFSET ?`
    )
    .all(page.limit, page.offset)
    .map(toRunSummary),
});

/** 実行の詳細(ファイルの状態別の数・サイズ) */
export type RunDetail = RunSummary & {
  revisionAfter: number | null;
  /** 検出したファイル(ソースのファイルの行の数) */
  detected: number;
  /** コピーした・コピー予定のもの(`adopted` と同じ) */
  copyFiles: number;
  /** その合計サイズ */
  copyBytes: number;
  /** 対象外・無視したもの */
  ignored: number;
};

export const getRunDetail = (
  db: Database,
  runId: number
): RunDetail | undefined => {
  const summary = getRunSummary(db, runId);
  if (!summary) return undefined;
  const counts = db
    .query<
      {
        detected: number;
        copyBytes: number;
        ignored: number;
        revisionAfter: number | null;
      },
      [number, number]
    >(
      `SELECT count(*) AS detected,
              coalesce(sum(size_bytes) FILTER (WHERE state IN ('planned', 'done')), 0) AS copyBytes,
              count(*) FILTER (WHERE state = 'ignored') AS ignored,
              (SELECT revision_after FROM runs WHERE run_id = ?) AS revisionAfter
       FROM source_files WHERE run_id = ?`
    )
    .get(runId, runId);
  return {
    ...summary,
    revisionAfter: counts?.revisionAfter ?? null,
    detected: counts?.detected ?? 0,
    copyFiles: summary.adopted,
    copyBytes: counts?.copyBytes ?? 0,
    ignored: counts?.ignored ?? 0,
  };
};
