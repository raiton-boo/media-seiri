import type { Database } from 'bun:sqlite';

/** ソース(ドライブ)の、これまでの取り込み(本実行・dry-run を除く) */
export type VolumeHistory = {
  /** 本実行の回数(完了・中断) */
  runs: number;
  /** 最後の本実行の開始時刻(UTC の ISO 8601)。なければ null */
  lastStartedAt: string | null;
  /** このソースから、ライブラリに取り込んだ(コピーした)ファイルの数 */
  filesDone: number;
};

/** あるソースの、これまでの取り込み。`excludeRunId` の実行は、数えない(いま始めた実行を、除くため) */
export const getVolumeHistory = (
  db: Database,
  volumeId: number,
  excludeRunId?: number
): VolumeHistory => {
  const runs = db
    .query<{ runs: number; lastStartedAt: string | null }, [number, number]>(
      `SELECT count(*) AS runs, max(started_at) AS lastStartedAt FROM runs
       WHERE source_volume_id = ? AND kind = 'ingest' AND is_dry_run = 0
         AND status IN ('completed', 'interrupted') AND run_id <> ?`
    )
    .get(volumeId, excludeRunId ?? -1);
  const files = db
    .query<{ n: number }, [number]>(
      `SELECT count(*) AS n FROM source_files WHERE volume_id = ? AND state = 'done'`
    )
    .get(volumeId);
  return {
    runs: runs?.runs ?? 0,
    lastStartedAt: runs?.lastStartedAt ?? null,
    filesDone: files?.n ?? 0,
  };
};

/** ソースごとの履歴の 1 行(`seiri sources`) */
export type SourceHistoryRow = VolumeHistory & {
  volumeId: number;
  volumeUuid: string;
  label: string | null;
  fsType: string | null;
  /** dry-run の回数 */
  dryRuns: number;
};

/** この台帳に記録された、すべてのソースの履歴(最後の取り込みが新しい順) */
export const listSourceHistory = (db: Database): SourceHistoryRow[] =>
  db
    .query<SourceHistoryRow, []>(
      `SELECT v.volume_id AS volumeId, v.volume_uuid AS volumeUuid, v.label AS label, v.fs_type AS fsType,
         (SELECT count(*) FROM runs r WHERE r.source_volume_id = v.volume_id AND r.kind = 'ingest'
            AND r.is_dry_run = 0 AND r.status IN ('completed', 'interrupted')) AS runs,
         (SELECT max(r.started_at) FROM runs r WHERE r.source_volume_id = v.volume_id AND r.kind = 'ingest'
            AND r.is_dry_run = 0 AND r.status IN ('completed', 'interrupted')) AS lastStartedAt,
         (SELECT count(*) FROM source_files s WHERE s.volume_id = v.volume_id AND s.state = 'done') AS filesDone,
         (SELECT count(*) FROM runs r WHERE r.source_volume_id = v.volume_id AND r.kind = 'ingest'
            AND r.is_dry_run = 1) AS dryRuns
       FROM volumes AS v
       WHERE EXISTS (SELECT 1 FROM runs r WHERE r.source_volume_id = v.volume_id AND r.kind = 'ingest')
       ORDER BY lastStartedAt IS NULL, lastStartedAt DESC, v.volume_id`
    )
    .all();
