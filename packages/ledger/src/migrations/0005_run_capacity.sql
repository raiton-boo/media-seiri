-- 取り込みの実行ごとに、容量の見積り(必要な容量・保存先の空き)を残す。dry-run の結果の画面で、
-- 「必要な容量(余裕分を含む)と、保存先の空き → 足りているか」を、あとから見られるようにするため。
-- それ以前の実行は、NULL(見積りが残っていない)。
ALTER TABLE runs ADD COLUMN required_bytes INTEGER CHECK (required_bytes IS NULL OR required_bytes >= 0);
ALTER TABLE runs ADD COLUMN destination_free_bytes INTEGER CHECK (destination_free_bytes IS NULL OR destination_free_bytes >= 0);
