# file-seiri ドキュメント

## 1. 読む順番

1. [overview.md](overview.md): 何を作るか(全体像)
2. [requirements.md](requirements.md): 要件(何を実現するか)
3. [specification.md](specification.md): 仕様(どう決めたか。**正本**)
4. [features/](features/): 機能ごとの詳しい説明
5. [er.md](er.md)・[flows.md](flows.md): 台帳の ER 図、処理フロー(Mermaid)
6. [tech-selection.md](tech-selection.md): 技術選定
7. [design.md](design.md): デザイン方針
8. [open-items.md](open-items.md): 未決・仮の一覧
9. [rules/](rules/): 開発ルール([README](rules/README.md))

## 2. 正本の決め方

同じ内容を、複数の文書に書かない。食い違ったときは、**正本**に合わせる。

| 内容 | 正本 |
| :--- | :--- |
| やること・やらないこと | requirements.md |
| 規則・数値・名前・フォルダ構成 | specification.md |
| 画面の見た目(色・文字・枠) | design.md |
| 台帳の項目 | er.md |
| 技術の選択と理由 | tech-selection.md |
| 未決・仮 | open-items.md |

要件は、番号ではなく**名前つきのリンク**で参照する(例: [コピー専用](requirements.md#c-03))。要件を足すときは、`requirements.md` の表に、名前と `<a id="…">` を付ける。

features/・flows.md は、正本の規則を**説明・図示**するもので、規則そのものを新しく決めない。規則を変えるときは、正本を先に直す。

## 3. 用語

| 用語 | 意味 |
| :--- | :--- |
| ライブラリ | 整理したファイルの置き場(`YYYY/MM/`)。根にマーカーファイルがある |
| ソース | 取り込み元(内蔵・外付けのフォルダ、ZIP) |
| 台帳(カタログ) | 取り込んだファイルの情報を持つ SQLite のデータベース(`catalog.sqlite`)。どちらの言い方も使う(同じもの) |
| スナップショット | 台帳のコピー。ライブラリの `.file-seiri/` に置き、家の PC で閲覧するために使う |
| できごと | アルバムで、時刻と場所から自動でまとめた写真のかたまり(台帳の `album_events`) |
| イベント(ログ) | 実行中の処理の記録(台帳の `events`)。アルバムの「できごと」とは別物 |
| 原本 | ライブラリにコピーされた、元の大きさのファイル |

## 4. 状態の凡例

各文書の **確定** は合意済み、**仮** は暫定。仮は、[open-items.md](open-items.md) で管理する。
