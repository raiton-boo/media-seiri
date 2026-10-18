import type { Database } from 'bun:sqlite';
import { classifyFile } from '@file-seiri/core';
import type { RunKind, RunStatus } from './runs.ts';

/** ダッシュボードの概要(通常の実行で取り込んだデータ。dry-run は含まない) */
export type DashboardSummary = {
  files: {
    /** 写真・動画・RAW の合計(サイドカーは、数えない) */
    total: number;
    photos: number;
    videos: number;
    raws: number;
    /** ライブラリのファイルすべて(サイドカーを含む)の総サイズ */
    sizeBytes: number;
  };
  /** 日付が取れた範囲(`taken_at` の最小・最大。精度は、それぞれの精度まで)。1 枚もなければ null */
  period: { from: string; to: string } | null;
  /** GPS のあり・なし(写真・動画・RAW。同じ内容は、1 枚として数える) */
  gps: { with: number; without: number };
  /** 最後に完了した取り込み(dry-run を除く)の終了時刻(UTC)。なければ null */
  lastIngestAt: string | null;
  /** 要チェックの件数 */
  attention: {
    errors: number;
    /** 日付を、本体ではなく、json・ファイル名から決めたもの */
    dateFallback: number;
    /** `_unknown/` に置いたもの */
    dateUnknown: number;
    duplicates: number;
  };
};

const MEDIA_KINDS = new Set(['photo', 'raw', 'video']);

const countOf = (db: Database, sql: string): number =>
  db.query<{ n: number }, []>(sql).get()?.n ?? 0;

export const getDashboardSummary = (db: Database): DashboardSummary => {
  const files = { total: 0, photos: 0, videos: 0, raws: 0, sizeBytes: 0 };
  // 種類は、拡張子で決める(台帳の `library_files` は、種類を持たないため)。ファイルごとの 1 行だけ読む
  const rows = db
    .query<{ relPath: string; sizeBytes: number }, []>(
      `SELECT f.rel_path AS relPath, c.size_bytes AS sizeBytes
       FROM library_files AS f JOIN contents AS c ON c.content_id = f.content_id`
    )
    .all();
  for (const row of rows) {
    files.sizeBytes += row.sizeBytes;
    const kind = classifyFile(row.relPath);
    if (!MEDIA_KINDS.has(kind)) continue;
    files.total += 1;
    if (kind === 'photo') files.photos += 1;
    else if (kind === 'video') files.videos += 1;
    else files.raws += 1;
  }

  const range = db
    .query<{ fromAt: string | null; toAt: string | null }, []>(
      `SELECT min(taken_at) AS fromAt, max(taken_at) AS toAt FROM media_metadata
       WHERE taken_at IS NOT NULL
         AND content_id IN (SELECT content_id FROM library_files)`
    )
    .get();
  const gps = db
    .query<{ withGps: number; withoutGps: number }, []>(
      `SELECT count(gps_lat) AS withGps, count(*) - count(gps_lat) AS withoutGps
       FROM media_metadata WHERE content_id IN (SELECT content_id FROM library_files)`
    )
    .get();

  return {
    files,
    period:
      range?.fromAt && range.toAt
        ? { from: range.fromAt, to: range.toAt }
        : null,
    gps: { with: gps?.withGps ?? 0, without: gps?.withoutGps ?? 0 },
    lastIngestAt:
      db
        .query<{ at: string | null }, []>(
          `SELECT max(finished_at) AS at FROM runs
           WHERE kind = 'ingest' AND is_dry_run = 0 AND status = 'completed'`
        )
        .get()?.at ?? null,
    attention: {
      errors: countOf(
        db,
        `SELECT count(*) AS n FROM errors AS e
         JOIN runs AS r ON r.run_id = e.run_id WHERE r.is_dry_run = 0`
      ),
      dateFallback: countOf(
        db,
        `SELECT count(*) AS n FROM library_files AS f
         JOIN media_metadata AS m ON m.content_id = f.content_id
         WHERE m.date_source IN ('json', 'filename')`
      ),
      dateUnknown: countOf(
        db,
        "SELECT count(*) AS n FROM library_files WHERE bucket LIKE 'unknown\\_%' ESCAPE '\\'"
      ),
      duplicates: countOf(
        db,
        `SELECT count(*) AS n FROM duplicate_links AS d
         JOIN source_files AS s ON s.source_file_id = d.skipped_source_file_id
         JOIN runs AS r ON r.run_id = s.run_id WHERE r.is_dry_run = 0`
      ),
    },
  };
};

/** 実行ごとの件数(採用 = コピーした・コピー予定のもの) */
export type RunSummary = {
  runId: number;
  kind: RunKind;
  isDryRun: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** ソースのドライブの名前(検査・サムネイルでは、ライブラリのドライブ) */
  sourceLabel: string | null;
  adopted: number;
  duplicates: number;
  dateFallback: number;
  errors: number;
};

type RunSummaryRow = Omit<RunSummary, 'isDryRun'> & { isDryRun: number };

const RUN_SUMMARY_SQL = `SELECT r.run_id AS runId, r.kind, r.is_dry_run AS isDryRun, r.status,
              r.started_at AS startedAt, r.finished_at AS finishedAt, v.label AS sourceLabel,
              (SELECT count(*) FROM source_files WHERE run_id = r.run_id AND state IN ('planned', 'done')) AS adopted,
              (SELECT count(*) FROM source_files WHERE run_id = r.run_id AND state = 'duplicate') AS duplicates,
              (SELECT count(*) FROM source_files AS s
                 JOIN media_metadata AS m ON m.content_id = s.content_id
                 WHERE s.run_id = r.run_id AND s.state IN ('planned', 'done')
                   AND m.date_source IN ('json', 'filename')) AS dateFallback,
              (SELECT count(*) FROM errors WHERE run_id = r.run_id) AS errors
       FROM runs AS r JOIN volumes AS v ON v.volume_id = r.source_volume_id`;

const toRunSummary = (row: RunSummaryRow): RunSummary => ({
  ...row,
  isDryRun: row.isDryRun === 1,
});

/** 新しい実行から、`limit` 件(実行の ID の降順) */
export const listRunSummaries = (db: Database, limit: number): RunSummary[] =>
  db
    .query<RunSummaryRow, [number]>(
      `${RUN_SUMMARY_SQL} ORDER BY r.run_id DESC LIMIT ?`
    )
    .all(limit)
    .map(toRunSummary);

const getRunSummary = (db: Database, runId: number): RunSummary | undefined => {
  const row = db
    .query<RunSummaryRow, [number]>(`${RUN_SUMMARY_SQL} WHERE r.run_id = ?`)
    .get(runId);
  return row ? toRunSummary(row) : undefined;
};

/** 実行中の取り込み(進み具合) */
export type RunningProgress = {
  runId: number;
  sourceLabel: string | null;
  startedAt: string;
  /** 対象のファイル数(無視したものを除く) */
  total: number;
  /** 終えたファイル数(コピー済み・重複・エラー) */
  done: number;
  adopted: number;
  duplicates: number;
  dateFallback: number;
  errors: number;
  /** コピーする予定の合計サイズと、コピーし終えたサイズ(速さ・残り時間の見積りに使う) */
  plannedBytes: number;
  copiedBytes: number;
};

/** 実行中(`running`)の本実行の、進み具合。なければ undefined。実行中に落ちたものも、`running` のまま残る(呼び出し側が、ロックで確かめる) */
export const getRunningProgress = (
  db: Database
): RunningProgress | undefined => {
  const run = db
    .query<
      { runId: number; startedAt: string; sourceLabel: string | null },
      []
    >(
      `SELECT r.run_id AS runId, r.started_at AS startedAt, v.label AS sourceLabel
       FROM runs AS r JOIN volumes AS v ON v.volume_id = r.source_volume_id
       WHERE r.kind = 'ingest' AND r.is_dry_run = 0 AND r.status = 'running'
       ORDER BY r.run_id DESC LIMIT 1`
    )
    .get();
  if (!run) return undefined;
  const counts = db
    .query<
      {
        total: number;
        done: number;
        adopted: number;
        duplicates: number;
        plannedBytes: number;
        copiedBytes: number;
      },
      [number]
    >(
      `SELECT count(*) FILTER (WHERE state != 'ignored') AS total,
              count(*) FILTER (WHERE state IN ('done', 'duplicate', 'error')) AS done,
              count(*) FILTER (WHERE state IN ('planned', 'done')) AS adopted,
              count(*) FILTER (WHERE state = 'duplicate') AS duplicates,
              coalesce(sum(size_bytes) FILTER (WHERE state IN ('planned', 'done')), 0) AS plannedBytes,
              coalesce(sum(size_bytes) FILTER (WHERE state = 'done'), 0) AS copiedBytes
       FROM source_files WHERE run_id = ?`
    )
    .get(run.runId);
  const summary = getRunSummary(db, run.runId);
  return {
    ...run,
    total: counts?.total ?? 0,
    done: counts?.done ?? 0,
    adopted: counts?.adopted ?? 0,
    duplicates: counts?.duplicates ?? 0,
    plannedBytes: counts?.plannedBytes ?? 0,
    copiedBytes: counts?.copiedBytes ?? 0,
    dateFallback: summary?.dateFallback ?? 0,
    errors: summary?.errors ?? 0,
  };
};
