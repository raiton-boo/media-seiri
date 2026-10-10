# 処理フロー

仕様書(`docs/specification.md`)の規則を、処理の流れとして図にする。
状態の凡例: **確定** = 合意済みの規則に基づく / **仮** = 仕様書の「仮」に基づく。

## 1. 取り込み全体の流れ(CLI)

仕様書 §4-1, §9, §11 に対応する。

```mermaid
flowchart TD
    START([ingest 開始]) --> SEL["ソースと保存先を選択<br/>drives の一覧から選ぶ"]
    SEL --> SAME{"保存先と<br/>ソースが同じ?"}
    SAME -->|はい| STOP1([停止: 同じドライブ])
    SAME -->|いいえ| DEST["保存先を検査"]
    DEST --> DEST_OK{"書き込み可能で<br/>形式が適切?"}
    DEST_OK -->|いいえ| STOP2(["停止: DEST_NOT_WRITABLE /<br/>DEST_FORMAT_UNSUPPORTED"])
    DEST_OK -->|はい| LIB{"ライブラリの<br/>目印がある?"}
    LIB -->|なし| INIT["library init を確認して作成"]
    LIB -->|あり| SNAP["台帳のリビジョンを確認<br/>スナップショットが新しければ利用者に確認"]
    INIT --> SNAP
    SNAP --> SCAN["ソースをスキャン<br/>対象の検出・除外・ZIP の展開計画"]
    SCAN --> CAP["容量チェック<br/>必要量 と 空き容量を比較"]
    CAP --> CAP_OK{"足りる?"}
    CAP_OK -->|いいえ| STOP3([停止: CAPACITY_SHORTAGE])
    CAP_OK -->|はい| DRY{"dry-run?"}
    DRY -->|はい| PLAN["ファイルごとの処理を<br/>コピー手前まで実行<br/>結果を dry_run として記録"]
    DRY -->|いいえ| LOCK["ライブラリの書き込みロックを取得"]
    LOCK --> LOCK_OK{"取得できた?"}
    LOCK_OK -->|いいえ| WAIT["待機または終了<br/>保持者を表示"]
    LOCK_OK -->|はい| EACH["ファイルごとの処理<br/>2章の流れ"]
    EACH --> POST["後処理<br/>台帳のスナップショットをライブラリへ保存"]
    POST --> UNLOCK["ロックを解放"]
    PLAN --> SUMMARY
    UNLOCK --> SUMMARY["サマリー表示<br/>採用 / スキップ / フォールバック / エラー"]
    SUMMARY --> NEXT{"次のソースがある?"}
    NEXT -->|はい| SEL
    NEXT -->|いいえ| END([終了])
```

- ソースが複数ある場合は、1つずつ順番に処理する [V-06]。
- dry-run でも、容量チェックの結果を表示する [X-02]。

## 2. 1ファイルあたりの処理

仕様書 §4-2, §5, §7 に対応する。

```mermaid
flowchart TD
    F([ソースのファイル]) --> KIND{"対象の種別?"}
    KIND -->|対象外のサイドカー<br/>aae thm lrv など| IGN["ignored として件数を記録"]
    KIND -->|空ファイル| E0["EMPTY_FILE を記録"]
    KIND -->|ZIP| ZIPF["3章の ZIP 処理へ"]
    KIND -->|写真 動画 RAW| ANA["解析<br/>メタデータを取得"]
    ANA --> BROKEN{"破損している?"}
    BROKEN -->|はい| REP["5章の修復へ"]
    BROKEN -->|いいえ| HASH["ハッシュ計算<br/>キャッシュがあれば再利用"]
    REP --> REP_OK{"修復できた?"}
    REP_OK -->|はい| HASH
    REP_OK -->|いいえ| UNREAD["読み取り不可として<br/>_unknown/読み取り不可/ へ計画"]
    HASH --> DUP{"ハッシュが<br/>カタログと一致?"}
    DUP -->|はい| SKIP["重複としてスキップ<br/>採用側との対応を記録"]
    DUP -->|いいえ| DATE["日付の決定<br/>4章の流れ"]
    DATE --> NAME["置き場所と名前を決定<br/>同名グループ 連番 衝突判定"]
    UNREAD --> NAME
    NAME --> DRYQ{"dry-run?"}
    DRYQ -->|はい| REC_DRY["コピー予定として記録して終了"]
    DRYQ -->|いいえ| COPY["コピー<br/>一時ファイルに書く<br/>ハッシュは読みながら計算"]
    COPY --> THUMB["サムネイルを作成"]
    THUMB --> VER["キャッシュを避けて読み直し<br/>ハッシュを比較"]
    VER --> VER_OK{"一致?"}
    VER_OK -->|いいえ| ERR["一時ファイルを削除<br/>HASH_MISMATCH を記録"]
    VER_OK -->|はい| REN["上書きしない方法で<br/>正式名へ名前を変更"]
    REN --> REN_OK{"同名が既にある?"}
    REN_OK -->|はい| NAME
    REN_OK -->|いいえ| REC["library_files に記録"]
    REC --> DONE([done])
    SKIP --> DONE2([duplicate])
    ERR --> DONE3([error])
```

- 同名が直前に作られていた場合は、連番を取り直して、再度コピーする(仕様書 §7-3)。
- 「読み取り不可」のうち、バイト自体が読めないものは、コピーできないので `COPY_FAILED` または `READ_FAILED` をエラー一覧にだけ記録する(仕様書 §10-3)。

## 3. ZIP の処理

仕様書 §10-1 に対応する。ZIP は、ZIP 全体を展開せず、中の1ファイルずつを取り出して処理する。

```mermaid
flowchart TD
    Z([ZIP を検出]) --> DEPTH{"入れ子の深さ<br/>3 以内?"}
    DEPTH -->|いいえ| WARN["警告を記録<br/>ZIP_DEPTH_EXCEEDED<br/>この ZIP は開かない"]
    DEPTH -->|はい| OPEN{"開けるか?"}
    OPEN -->|暗号化| E1["ZIP_ENCRYPTED を記録"]
    OPEN -->|壊れている| E2["READ_FAILED を記録"]
    OPEN -->|はい| LIST["中身の一覧を取得<br/>名前の文字コードを判定 cp932 など"]
    LIST --> LOOP["1エントリずつ処理"]
    LOOP --> PATH{"パスは安全か?"}
    PATH -->|いいえ| E3["ZIP_UNSAFE_PATH を記録して<br/>このエントリを無視"]
    PATH -->|はい| ENTRY{"エントリの種別"}
    ENTRY -->|ZIP| NEST["深さ+1 で、この流れを再帰"]
    ENTRY -->|json| JSONR["Takeout の json として<br/>対応する写真の日付と GPS に使う"]
    ENTRY -->|写真 動画 RAW| EXTRACT["tmp/ に取り出す"]
    EXTRACT --> SIZE{"サイズが上限<br/>以内?"}
    SIZE -->|いいえ| E4["エラーを記録"]
    SIZE -->|はい| PROC["2章の流れで処理"]
    PROC --> DEL["tmp/ の一時ファイルをすぐ削除"]
    DEL --> LOOP
```

- 元の場所の記録は `ソース/path/a.zip!/inner/b.jpg` の形にする。
- Takeout の json は、写真と同じフォルダにある対応ファイルとして、先に読んでおく。

## 4. 日付の決定と置き場所

仕様書 §2-2, §3 に対応する。

```mermaid
flowchart TD
    D([日付の決定]) --> S1{"EXIF / 動画の<br/>メタデータに日付がある?"}
    S1 -->|あり 有効| FULLQ
    S1 -->|なし または 無効| S2{"Takeout の json に<br/>日付がある?"}
    S2 -->|あり 有効| FB1["フォールバック: json を記録"]
    S2 -->|なし または 無効| S3{"ファイル名に<br/>日付がある?"}
    S3 -->|あり 有効| FB2["フォールバック: filename を記録"]
    S3 -->|なし| NOREC["更新日 mtime は参考情報として記録のみ"]
    FB1 --> PREC
    FB2 --> PREC
    FULLQ["通常: 本体のメタデータ"] --> PREC["日付の精度を判定"]
    NOREC --> NODATE{"値はあったが無効だった?"}
    NODATE -->|はい| INV["invalid"]
    NODATE -->|いいえ| NONE["none"]
    PREC --> P{"精度"}
    P -->|full| B1["YYYY/MM/<br/>YYYY.MM.DD_HH-MM-SS"]
    P -->|date| B2["YYYY/MM/_時刻不明/<br/>YYYY.MM.DD"]
    P -->|month| B3["YYYY/MM/_日付不明/<br/>YYYY.MM_元の名前"]
    P -->|year| B4["YYYY/_月日不明/<br/>YYYY_元の名前"]
    INV --> B6["_unknown/日付が不正/<br/>元の名前"]
    NONE --> B5["_unknown/日付なし/<br/>元の名前"]
```

- 修復後も日付が取れなかったものは、`_unknown/修復後も日付なし/` に置く(5章)。
- 同名グループでは、グループ内で最も精度の高い取得元で、1回だけ決める(仕様書 §2-3)。
- 日付は、一部が欠けている場合、有効な範囲までを採用する。

## 5. 破損の検出と修復

仕様書 §10-2, §10-3 に対応する。修復は、元ファイルを変更せず、`repaired/` に別ファイルとして作る。

```mermaid
flowchart TD
    R([破損を検出]) --> T{"種別"}
    T -->|動画| V1["動画の再構築<br/>コンテナを作り直す"]
    T -->|画像| M1["メタデータの再書込み"]
    V1 --> V_OK{"再生できる?"}
    V_OK -->|いいえ| M1
    M1 --> M_OK{"読み取れる?"}
    M_OK -->|いいえ| S1{"画像?"}
    S1 -->|はい| IS["切れた画像の救出<br/>読み取れる範囲を保存"]
    S1 -->|いいえ| FAIL
    IS --> I_OK{"救出できた?"}
    I_OK -->|いいえ| FAIL["REPAIR_FAILED を記録<br/>試した手順を repair_attempts に残す"]
    V_OK -->|はい| OK
    M_OK -->|はい| OK
    I_OK -->|はい| OK["修復済みの印を付けて<br/>repaired/ に保存"]
    OK --> NEXT["通常の取り込み 2章 へ<br/>重複判定は修復後のハッシュで行う"]
    FAIL --> BYTES{"バイトは読める?"}
    BYTES -->|はい| UNR["元のまま<br/>_unknown/読み取り不可/ へコピー"]
    BYTES -->|いいえ| ERRONLY["コピーできない<br/>エラー一覧にだけ記録"]
```

- 各手順の成否は、すべて `repair_attempts` に残す。
- 修復で直った場合でも、日付が取れなければ `_unknown/修復後も日付なし/` に置く。

## 6. CLI と Web の同期

仕様書 §12, §13 に対応する。CLI と Web は同じ台帳を共有する。書き込むのは CLI だけで、Web は読み取り専用。2つの実行が同時に書き込まないよう、ロックで避ける。

```mermaid
flowchart LR
    subgraph CLIside["CLI"]
        C1["取り込みを実行"] --> C2["events を書き込み<br/>files や runs を更新"]
        C2 --> C3["ターミナルにライブ表示"]
    end
    DB[("台帳<br/>SQLite")]
    subgraph Webside["Web"]
        W1["events と runs を読み取り"] --> W2["実行状況をリアルタイム表示"]
        W3["一覧 地図 統計 アルバム"]
    end
    C2 --> DB
    DB --> W1
    DB --> W3
    LOCK{{"書き込みロック"}}
    C1 -.取得.-> LOCK
```

- Web の読み取りは、ロックと無関係に常にできる。
- Web は、すべてのモードで読み取り専用で、ロックを取らない。他の PC では、スナップショットを開く。

## 7. ライブラリの照合(verify)

仕様書 §6, §8-4 に対応する。

```mermaid
flowchart TD
    V([verify 開始]) --> M["ライブラリの目印を確認<br/>ライブラリ ID が台帳と一致?"]
    M -->|いいえ| STOP([停止: 別のライブラリ])
    M -->|はい| ITER["library_files を1件ずつ処理"]
    ITER --> EXIST{"ファイルが存在する?"}
    EXIST -->|いいえ| E1["VERIFY_MISMATCH を記録<br/>欠落"]
    EXIST -->|はい| H["ハッシュを計算<br/>キャッシュは使わない"]
    H --> CMP{"台帳のハッシュと一致?"}
    CMP -->|いいえ| E2["VERIFY_MISMATCH を記録<br/>不一致"]
    CMP -->|はい| OK["一致として記録"]
    E1 --> ITER
    E2 --> ITER
    OK --> ITER
    ITER --> EXTRA["台帳にないファイルを検出<br/>報告のみ 削除しない"]
    EXTRA --> REPORT["結果を表示<br/>一致 / 不一致 / 欠落 / 未登録"]
```

- ライブラリを別のドライブへコピーしたあとの確認に使う。
- 検出した差異は、エラー一覧に記録する。ファイルの修復や削除はしない。

## 8. 未決

- 各図の「仮」の規則は、`features/` で詳細を確認する。
- 並列処理の具体的な構成(ファイル単位か、ドライブ単位か)は、技術選定のあとで決める(仕様書 §17)。
