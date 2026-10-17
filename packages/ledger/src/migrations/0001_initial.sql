-- 台帳の最初のスキーマ(docs/er.md)。適用したあとは、書き換えない。変えるときは、新しい番号の移行を足す。
-- 時刻(*_at)は UTC の ISO 8601、撮影日時(taken_at など)は core の formatTakenAt の形式。
-- 真偽は 0 / 1。更新日(*_ms)は、1970-01-01 UTC からのミリ秒(小数を切り捨てた整数)。

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT INTO meta (key, value) VALUES ('revision', '0');

CREATE TABLE volumes (
  volume_id    INTEGER PRIMARY KEY,
  volume_uuid  TEXT NOT NULL UNIQUE,
  label        TEXT,
  fs_type      TEXT,
  media_kind   TEXT CHECK (media_kind IN ('hdd', 'ssd', 'usb')),
  last_seen_at TEXT NOT NULL
) STRICT;

CREATE TABLE runs (
  run_id           INTEGER PRIMARY KEY,
  source_volume_id INTEGER NOT NULL REFERENCES volumes (volume_id),
  is_dry_run       INTEGER NOT NULL DEFAULT 0 CHECK (is_dry_run IN (0, 1)),
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  revision_after   INTEGER
) STRICT;

CREATE INDEX runs_source_volume_id ON runs (source_volume_id);

CREATE TABLE contents (
  content_id INTEGER PRIMARY KEY,
  -- SHA-256 の 16 進(小文字)
  hash       TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0)
) STRICT;

CREATE TABLE source_files (
  source_file_id INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs (run_id),
  volume_id      INTEGER NOT NULL REFERENCES volumes (volume_id),
  -- ZIP の中身なら、親の ZIP
  container_id   INTEGER REFERENCES source_files (source_file_id),
  zip_depth      INTEGER NOT NULL DEFAULT 0 CHECK (zip_depth >= 0),
  rel_path       TEXT NOT NULL,
  -- ZIP の中のパス。ZIP の中身のときだけ持つ
  entry_path     TEXT,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms       INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('photo', 'raw', 'video', 'sidecar')),
  ext            TEXT NOT NULL,
  content_id     INTEGER REFERENCES contents (content_id),
  state          TEXT NOT NULL DEFAULT 'scanned'
                 CHECK (state IN ('scanned', 'analyzed', 'planned', 'duplicate', 'done', 'error', 'ignored')),
  ignore_reason  TEXT,
  CHECK ((container_id IS NULL) = (entry_path IS NULL))
) STRICT;

-- 同じ実行で、同じファイルを 2 度記録しない(再開のときの二重登録を防ぐ)
CREATE UNIQUE INDEX source_files_identity
  ON source_files (run_id, volume_id, rel_path, COALESCE(container_id, 0), COALESCE(entry_path, ''));
CREATE INDEX source_files_run_state ON source_files (run_id, state);
-- 再実行で、処理済みのファイルを探す
CREATE INDEX source_files_volume_path ON source_files (volume_id, rel_path);
CREATE INDEX source_files_content_id ON source_files (content_id);
CREATE INDEX source_files_container_id ON source_files (container_id);

CREATE TABLE hash_cache (
  volume_id   INTEGER NOT NULL REFERENCES volumes (volume_id),
  rel_path    TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms    INTEGER NOT NULL,
  content_id  INTEGER NOT NULL REFERENCES contents (content_id),
  computed_at TEXT NOT NULL,
  PRIMARY KEY (volume_id, rel_path, size_bytes, mtime_ms)
) STRICT, WITHOUT ROWID;

CREATE INDEX hash_cache_content_id ON hash_cache (content_id);

CREATE TABLE media_metadata (
  content_id     INTEGER PRIMARY KEY REFERENCES contents (content_id),
  -- 日付なし(none)と不正(invalid)のときだけ、NULL
  taken_at       TEXT,
  date_precision TEXT NOT NULL
                 CHECK (date_precision IN ('full', 'date', 'month', 'year', 'none', 'invalid')),
  date_source    TEXT NOT NULL CHECK (date_source IN ('exif', 'video', 'json', 'filename', 'none')),
  date_reason    TEXT NOT NULL DEFAULT '',
  mtime_ref_ms   INTEGER,
  camera_make    TEXT,
  camera_model   TEXT,
  lens_model     TEXT,
  width          INTEGER CHECK (width >= 0),
  height         INTEGER CHECK (height >= 0),
  duration_sec   REAL CHECK (duration_sec >= 0),
  gps_lat        REAL CHECK (gps_lat BETWEEN -90 AND 90),
  gps_lon        REAL CHECK (gps_lon BETWEEN -180 AND 180),
  gps_alt        REAL,
  CHECK ((date_precision IN ('none', 'invalid')) = (taken_at IS NULL))
) STRICT;

CREATE INDEX media_metadata_taken_at ON media_metadata (taken_at);
CREATE INDEX media_metadata_date_precision ON media_metadata (date_precision);
CREATE INDEX media_metadata_date_source ON media_metadata (date_source);
CREATE INDEX media_metadata_gps ON media_metadata (gps_lat, gps_lon) WHERE gps_lat IS NOT NULL;

CREATE TABLE file_groups (
  group_id INTEGER PRIMARY KEY,
  -- 出力名の語幹
  stem     TEXT NOT NULL,
  bucket   TEXT NOT NULL
           CHECK (bucket IN ('full', 'time_unknown', 'date_unknown', 'md_unknown', 'unknown_none',
                             'unknown_invalid', 'unknown_repaired_nodate', 'unknown_unreadable'))
) STRICT;

CREATE TABLE album_events (
  album_event_id        INTEGER PRIMARY KEY,
  start_at              TEXT NOT NULL,
  end_at                TEXT NOT NULL,
  file_count            INTEGER NOT NULL CHECK (file_count >= 1),
  centroid_lat          REAL CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lon          REAL CHECK (centroid_lon BETWEEN -180 AND 180),
  -- library_files と、たがいに指し合う。代表の写真が消えても、できごとは残す
  cover_library_file_id INTEGER REFERENCES library_files (library_file_id) ON DELETE SET NULL,
  -- 4h / 5km など
  rule                  TEXT NOT NULL,
  computed_revision     INTEGER NOT NULL
) STRICT;

CREATE INDEX album_events_start_at ON album_events (start_at);

CREATE TABLE library_files (
  library_file_id INTEGER PRIMARY KEY,
  content_id      INTEGER NOT NULL REFERENCES contents (content_id),
  group_id        INTEGER NOT NULL REFERENCES file_groups (group_id),
  run_id          INTEGER NOT NULL REFERENCES runs (run_id),
  -- ライブラリの根からの相対パス
  rel_path        TEXT NOT NULL UNIQUE,
  bucket          TEXT NOT NULL
                  CHECK (bucket IN ('full', 'time_unknown', 'date_unknown', 'md_unknown', 'unknown_none',
                                    'unknown_invalid', 'unknown_repaired_nodate', 'unknown_unreadable')),
  is_repaired     INTEGER NOT NULL DEFAULT 0 CHECK (is_repaired IN (0, 1)),
  -- thumbs/ からの相対パス
  thumb_rel_path  TEXT,
  created_at      TEXT NOT NULL,
  -- 精度が低いもの(month 以下)は、NULL。できごとを計算し直すときも、写真は消さない
  album_event_id  INTEGER REFERENCES album_events (album_event_id) ON DELETE SET NULL
) STRICT;

CREATE INDEX library_files_album_event_id ON library_files (album_event_id);
CREATE INDEX library_files_content_id ON library_files (content_id);
CREATE INDEX library_files_group_id ON library_files (group_id);
CREATE INDEX library_files_run_id ON library_files (run_id);

CREATE TABLE duplicate_links (
  link_id                 INTEGER PRIMARY KEY,
  -- スキップ側は、採用側を 1 つだけ指す
  skipped_source_file_id  INTEGER NOT NULL UNIQUE REFERENCES source_files (source_file_id),
  adopted_library_file_id INTEGER NOT NULL REFERENCES library_files (library_file_id),
  created_at              TEXT NOT NULL
) STRICT;

CREATE INDEX duplicate_links_adopted ON duplicate_links (adopted_library_file_id);

CREATE TABLE repair_attempts (
  attempt_id     INTEGER PRIMARY KEY,
  source_file_id INTEGER NOT NULL REFERENCES source_files (source_file_id),
  method         TEXT NOT NULL CHECK (method IN ('video_remux', 'metadata_rewrite', 'image_salvage')),
  is_success     INTEGER NOT NULL CHECK (is_success IN (0, 1)),
  output_path    TEXT,
  detail         TEXT NOT NULL DEFAULT '',
  attempted_at   TEXT NOT NULL
) STRICT;

CREATE INDEX repair_attempts_source_file_id ON repair_attempts (source_file_id);

CREATE TABLE errors (
  error_id       INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs (run_id),
  source_file_id INTEGER REFERENCES source_files (source_file_id),
  -- 仕様書 §14 のコード。足すたびに移行が要らないように、CHECK は付けない(core の型で守る)
  code           TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  occurred_at    TEXT NOT NULL
) STRICT;

CREATE INDEX errors_run_id ON errors (run_id);
CREATE INDEX errors_source_file_id ON errors (source_file_id);

CREATE TABLE events (
  event_id       INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs (run_id),
  source_file_id INTEGER REFERENCES source_files (source_file_id),
  level          TEXT NOT NULL CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  code           TEXT NOT NULL,
  message        TEXT NOT NULL,
  occurred_at    TEXT NOT NULL
) STRICT;

-- 逐次ログの読み出し(Web のリアルタイム表示)
CREATE INDEX events_run_event ON events (run_id, event_id);
CREATE INDEX events_source_file_id ON events (source_file_id);

CREATE TABLE locks (
  lock_name    TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  acquired_at  TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
) STRICT;
