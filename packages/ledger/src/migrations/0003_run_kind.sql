-- 実行の種類。取り込み(ingest)のほかに、ライブラリの再照合(verify)も、実行として記録する
-- (エラー一覧・イベントは、実行に結びつくため)。既存の行は、すべて取り込み。
ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'ingest' CHECK (kind IN ('ingest', 'verify'));
