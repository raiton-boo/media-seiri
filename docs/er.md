# ER 図(台帳のデータ構造)

台帳(カタログ)は SQLite の 1 ファイルで、**ライブラリごとに 1 つ**(`specification.md` §8)。
CLI・Web・閲覧専用ビューアは、同じ台帳を共有する。閲覧専用ビューアは、スナップショットを読み取り専用で開く。

状態の凡例: **確定** = 設計方針が合意済み / **仮** = 暫定(`features/` と技術選定のあとで見直す)。
列の型は論理的なもの。実際の型(SQLite)は §7 に書く。

## 1. 全体図

```mermaid
erDiagram
    META {
        text key PK
        text value
    }
    VOLUMES {
        int volume_id PK
        text volume_uuid UK "ドライブの固有 ID"
        text label "表示名"
        text fs_type "exfat など"
        text media_kind "hdd / ssd / usb"
        text last_seen_at
    }
    RUNS {
        int run_id PK
        int source_volume_id FK
        int is_dry_run "1 なら集計に含めない"
        text status "running / completed / interrupted / failed"
        text started_at
        text finished_at
        int revision_after "実行後の台帳リビジョン"
    }
    SOURCE_FILES {
        int source_file_id PK
        int run_id FK
        int volume_id FK
        int container_id FK "ZIP 内なら親の ZIP"
        int zip_depth
        text rel_path "ボリューム内の相対パス"
        text entry_path "ZIP 内のパス"
        int size_bytes
        int mtime_ms
        text kind "photo / raw / video / sidecar"
        text ext
        int content_id FK
        text state "scanned / analyzed / planned / duplicate / done / error / ignored"
        text ignore_reason
    }
    CONTENTS {
        int content_id PK
        text hash UK
        int size_bytes
    }
    HASH_CACHE {
        int volume_id PK, FK
        text rel_path PK
        int size_bytes PK
        int mtime_ms PK
        int content_id FK
        text computed_at
    }
    MEDIA_METADATA {
        int content_id PK, FK
        text taken_at "決定した日時"
        text date_precision "full / date / month / year / none / invalid"
        text date_source "exif / video / json / filename / none"
        text date_reason "フォールバックの理由"
        int mtime_ref_ms "参考の更新日"
        text camera_make
        text camera_model
        text lens_model
        int width
        int height
        real duration_sec
        real gps_lat
        real gps_lon
        real gps_alt
    }
    FILE_GROUPS {
        int group_id PK
        text stem "出力名の語幹"
        text bucket "置き場所の区分"
    }
    LIBRARY_FILES {
        int library_file_id PK
        int content_id FK
        int group_id FK
        int run_id FK
        text rel_path UK "ライブラリの根からの相対パス"
        text bucket "full / time_unknown / date_unknown / md_unknown / unknown_*"
        int is_repaired
        text thumb_rel_path
        text created_at
        int album_event_id FK "できごと"
    }
    ALBUM_EVENTS {
        int album_event_id PK
        text start_at
        text end_at
        int file_count
        real centroid_lat
        real centroid_lon
        int cover_library_file_id FK "代表の写真"
        text rule "4h / 5km など"
        int computed_revision
    }
    DUPLICATE_LINKS {
        int link_id PK
        int skipped_source_file_id FK
        int adopted_library_file_id FK
        text created_at
    }
    REPAIR_ATTEMPTS {
        int attempt_id PK
        int source_file_id FK
        text method "video_remux / metadata_rewrite / image_salvage"
        int is_success
        text output_path
        text detail
        text attempted_at
    }
    ERRORS {
        int error_id PK
        int run_id FK
        int source_file_id FK
        text code
        text detail
        text occurred_at
    }
    EVENTS {
        int event_id PK
        int run_id FK
        int source_file_id FK
        text level "DEBUG / INFO / WARN / ERROR"
        text code
        text message
        text occurred_at
    }
    LOCKS {
        text lock_name PK
        text holder
        text acquired_at
        text heartbeat_at
    }

    VOLUMES ||--o{ RUNS : "ソースとして"
    VOLUMES ||--o{ SOURCE_FILES : "所属"
    VOLUMES ||--o{ HASH_CACHE : "キャッシュ"
    RUNS ||--o{ SOURCE_FILES : "検出"
    RUNS ||--o{ LIBRARY_FILES : "取り込み"
    RUNS ||--o{ ERRORS : "発生"
    RUNS ||--o{ EVENTS : "記録"
    SOURCE_FILES |o--o{ SOURCE_FILES : "ZIP の中身"
    SOURCE_FILES }o--o| CONTENTS : "内容"
    CONTENTS ||--o{ HASH_CACHE : "ハッシュ"
    CONTENTS ||--o| MEDIA_METADATA : "メタデータ"
    CONTENTS ||--o{ LIBRARY_FILES : "実体"
    FILE_GROUPS ||--o{ LIBRARY_FILES : "同名グループ"
    ALBUM_EVENTS ||--o{ LIBRARY_FILES : "含む"
    SOURCE_FILES ||--o{ DUPLICATE_LINKS : "スキップ側"
    LIBRARY_FILES ||--o{ DUPLICATE_LINKS : "採用側"
    SOURCE_FILES ||--o{ REPAIR_ATTEMPTS : "修復"
    SOURCE_FILES ||--o{ ERRORS : "対象"
    SOURCE_FILES ||--o{ EVENTS : "対象"
```

## 2. テーブルの説明

| テーブル          | 役割                                                                                               | 対応する要件         |
| :---------------- | :------------------------------------------------------------------------------------------------- | :------------------- |
| `meta`            | スキーマ版、ライブラリ ID、台帳のリビジョン番号を持つ(§8-2)                                        | [ライブラリの目印ファイル](requirements.md#m-05)、[スナップショットの保存](requirements.md#m-08)           |
| `volumes`         | ソースの外付け・内蔵ストレージ。名前ではなく、固有 ID で識別する                                   | [ボリューム ID で識別](requirements.md#v-02)                 |
| `runs`            | 実行ごとの記録。dry-run は `is_dry_run = 1` で区別する                                             | [実行 ID](requirements.md#m-03)、[dry-run を Web で確認](requirements.md#x-03)           |
| `source_files`    | 実行ごとに検出したソース側のファイル。ZIP の中身は、親の ZIP を `container_id` で指す              | [ZIP 内のファイル](requirements.md#t-03)、[ZIP の入れ子](requirements.md#t-04)           |
| `contents`        | ハッシュで識別する「内容」。同じハッシュは 1 行だけ                                                | [完全一致だけを重複とする](requirements.md#p-01)                 |
| `hash_cache`      | ハッシュのキャッシュ。キーは(ボリューム, 相対パス, サイズ, mtime)                                  | [ハッシュのキャッシュ](requirements.md#h-02)、[キャッシュを使わない再計算](requirements.md#h-03)           |
| `media_metadata`  | 内容ごとの、撮影日時・日付の精度・カメラ・GPS など                                                 | [メタデータの取得](requirements.md#i-02), D-_, G-_, S-\* |
| `file_groups`     | RAW+JPEG などの同名グループ。出力名の語幹を共有する                                                | [RAW と JPEG のペア](requirements.md#i-05)                 |
| `library_files`   | ライブラリに保存したファイル。台帳のパスはすべて相対パス                                           | [相対パスで記録](requirements.md#m-06)                 |
| `album_events`    | アルバムの単位「できごと」。取り込みの最後に、時刻の空きと場所から計算して保存する。Web は読むだけ | [できごとの自動まとめ](requirements.md#a-04)                 |
| `duplicate_links` | 重複の「スキップ側」と「採用側」の対応                                                             | [重複の自動スキップ](requirements.md#p-02)、[採用とスキップの比較画面](requirements.md#p-03)           |
| `repair_attempts` | 修復の試行の記録(手順・成否・出力先)                                                               | [自動修復](requirements.md#r-02)〜[修復の 3 つの手順](requirements.md#r-04)           |
| `errors`          | エラー一覧の元になる記録                                                                           | [各一覧の Web 閲覧](requirements.md#l-04)                 |
| `events`          | 逐次ログの元になるイベント。CLI の表示も Web の実行状況も、ここから作る                            | [CLI の逐次表示](requirements.md#l-01)、[実行状況の Web 表示](requirements.md#l-03)           |
| `locks`           | ライブラリへの書き込みの排他制御(§12)                                                              |                      |

## 3. 設計のポイント

### 3-1. 「内容」と「ファイル」を分ける(確定)

- 内容は `contents`(ハッシュで一意)、ファイルは `source_files` と `library_files`。
- 同じ内容が、複数のソースや複数の実行に現れても、メタデータは 1 回だけ取得して持てばよい。
- 重複は、「同じ `content_id` を持つ `source_files` のうち、採用されなかったもの」として表せる。

### 3-2. 日付フォールバックは、専用テーブルを持たない(確定)

- `media_metadata.date_source` が `exif` / `video` 以外のものが、フォールバック。
- 取得元の種別での絞り込み ([フォールバック一覧の絞り込み](requirements.md#d-05)) は、`date_source` の条件で行う。
- 日付の精度での絞り込み ([絞り込み](requirements.md#a-07)) は、`date_precision` の条件で行う。
- `date_reason` に、取得できなかった理由を持たせる。

### 3-3. dry-run の扱い(確定)

- dry-run も `runs` と `source_files` に記録する(`runs.is_dry_run = 1`)。
- 通常の集計(アルバム・地図・統計・重複)は、`is_dry_run = 0` の実行だけを対象にする。
- dry-run では `library_files` は作らない。

### 3-4. パスの持ち方(確定)

- ソース側: (`volume_id`, `rel_path`)。マウント先の絶対パスは持たない。
- ライブラリ側: ライブラリの根からの相対パス。
- ZIP の中身: 親の `source_files`(`container_id`)と、ZIP 内のパス(`entry_path`)で表す。
- これにより、ドライブ文字やマウント先が変わっても、台帳をそのまま使える ([ドライブ文字が変わっても動く](requirements.md#w-04))。

### 3-5. 重複の記録(確定)

- `duplicate_links` は、「スキップ側」と「採用側」の対応だけを持つ(自動スキップのみ)。
- 「別物」判定は作らない(スコープ外)。そのため、判定の状態や、追加コピーのジョブのテーブルは持たない。
- 将来、「別物」判定を追加する場合は、`duplicate_links` に状態の列と、ジョブのテーブルを追加する。

### 3-6. できごとと、サムネイル(確定)

- `album_events` は、取り込みの最後に、全体を計算し直して、保存する(§16-6)。各 `library_files` は、高々 1 つのできごとに属する(`album_event_id`)。精度が低いもの(`month` 以下)は、NULL。
- サムネイルの実体は、ファイル(正本は `data/` の `thumbs/`、ライブラリにコピー)。台帳には、`library_files.thumb_rel_path`(`thumbs/` からの相対パス)だけを持つ。
- 原本の探索(§16-7)のために、同じ `content_id` を持つ `library_files` と `source_files` を、すべて、たどれるようにする。

### 3-7. 更新日は、ミリ秒の整数で持つ(確定)

- `source_files.mtime_ms`・`hash_cache.mtime_ms`・`media_metadata.mtime_ref_ms` は、1970-01-01 UTC からの**ミリ秒の整数**。
- ファイルの更新日は、小数のミリ秒で返ることがある。保存するときも、キャッシュと照合するときも、**同じ丸め方(小数の部分を切り捨て)**にする。丸め方がずれると、同じファイルなのに、キャッシュが当たらない。この丸めは、`core` の `toMtimeMs` の 1 つだけにする。
- ナノ秒にしないのは、JavaScript の数値(2^53)で、ナノ秒の更新日を正確に持てないため。

## 4. 値の一覧

### 4-1. `source_files.state`

`scanned` → `analyzed` → `planned` → `done` の流れ。分岐は、`duplicate`(重複でスキップ)、`error`(エラー)、`ignored`(対象外)。
状態遷移は `specification.md` §4-3 に従う。

### 4-2. `library_files.bucket`(置き場所の区分)

| 値                        | 置き場所                     |
| :------------------------ | :--------------------------- |
| `full`                    | `YYYY/MM/`                   |
| `time_unknown`            | `YYYY/MM/_時刻不明/`         |
| `date_unknown`            | `YYYY/MM/_日付不明/`         |
| `md_unknown`              | `YYYY/_月日不明/`            |
| `unknown_none`            | `_unknown/日付なし/`         |
| `unknown_invalid`         | `_unknown/日付が不正/`       |
| `unknown_repaired_nodate` | `_unknown/修復後も日付なし/` |
| `unknown_unreadable`      | `_unknown/読み取り不可/`     |

### 4-3. `errors.code`

`specification.md` §14 のエラー分類に従う。

## 5. インデックス(仮)

| テーブル         | 列                                                  | 用途                                       |
| :--------------- | :-------------------------------------------------- | :----------------------------------------- |
| `contents`       | `hash`(ユニーク)                                    | 重複判定                                   |
| `hash_cache`     | (`volume_id`, `rel_path`, `size_bytes`, `mtime_ms`) | キャッシュの検索                           |
| `library_files`  | `rel_path`(ユニーク)                                | 衝突判定                                   |
| `library_files`  | `album_event_id`                                    | できごとの写真の一覧                       |
| `album_events`   | `start_at`                                          | できごとの並び(新しい順)                   |
| `media_metadata` | `taken_at`、`date_precision`、`date_source`         | アルバム・統計・フォールバック一覧         |
| `media_metadata` | `gps_lat`, `gps_lon`                                | 地図                                       |
| `source_files`   | (`run_id`, `state`)                                 | 実行ごとの一覧                             |
| `events`         | (`run_id`, `event_id`)                              | 逐次ログの読み出し(Web のリアルタイム表示) |

## 6. 運用上の注意

- 台帳は、書き込みを並行しても壊れない設定(WAL など)で使う。具体的な設定は技術選定のあとで決める。
- 書き込みはまとめてコミットする(`specification.md` §17-6)。
- スナップショットは、ライブラリの `.file-seiri/` に保存する。閲覧専用ビューアは、これを読み取り専用で開く。
- 台帳に個人情報(パス・GPS・撮影日時)が入るため、git にコミットしてはならない(`specification.md` §8-1)。

## 7. SQLite での型

- ID は `INTEGER PRIMARY KEY`。真偽は 0 / 1 の `INTEGER`(`CHECK` で制限する)。
- 実行・記録の時刻(`*_at`)は、UTC の ISO 8601 の `TEXT`。撮影日時(`taken_at`・`album_events.start_at`・`end_at`)は、`core` の `formatTakenAt` の形式の `TEXT`。
- `state`・`kind`・`bucket`・`level`・`date_precision`・`date_source`・`status`・`media_kind`・`method` は、`CHECK` で値を制限する。`errors.code` は、制限しない(コードを足すたびに移行が要るため。値は `core` の型で守る)。
- 全テーブルを `STRICT` にし、外部キーを強制する。
- スキーマの版は、`PRAGMA user_version` と `meta`(`schema_version`)の両方に持つ。移行は、番号つきの SQL で、台帳を書き込み用に開くときに、自動で適用する。
- `meta` のキー: `library_id`(ライブラリの目印ファイルと同じ ID)、`schema_version`、`revision`(実行のたびに増える整数)。
