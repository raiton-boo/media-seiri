-- 実行の種類に、サムネイルの作成(thumbs)を足す。CHECK は、あとから変えられないため、runs を作り直す。
-- 子のテーブル(source_files・events など)が runs を指しているため、外部キーの確認を、コミットまで延ばす
-- (作り直しの途中で、いったん runs がなくなる)。名前の付け替え(RENAME)は、子の参照も書き換えるため使わず、
-- 控えに退避 → runs を消す → 同じ名前で作り直す → 戻す、の順にする(戻すときの挿入で、延ばした確認が解ける)。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE runs_backup AS SELECT * FROM runs;

DROP TABLE runs;

CREATE TABLE runs (
  run_id           INTEGER PRIMARY KEY,
  source_volume_id INTEGER NOT NULL REFERENCES volumes (volume_id),
  is_dry_run       INTEGER NOT NULL DEFAULT 0 CHECK (is_dry_run IN (0, 1)),
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  revision_after   INTEGER,
  kind             TEXT NOT NULL DEFAULT 'ingest' CHECK (kind IN ('ingest', 'verify', 'thumbs'))
) STRICT;

INSERT INTO runs (run_id, source_volume_id, is_dry_run, status, started_at, finished_at, revision_after, kind)
  SELECT run_id, source_volume_id, is_dry_run, status, started_at, finished_at, revision_after, kind FROM runs_backup;

DROP TABLE runs_backup;

CREATE INDEX runs_source_volume_id ON runs (source_volume_id);
