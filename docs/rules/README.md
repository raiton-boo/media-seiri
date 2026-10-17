# 開発ルール (Development Rules)

開発に関する規約をまとめたリポジトリ。まずは下記の一覧から該当する規約を確認する。

## 規約一覧

| ファイル                                 | 概要                                                         |
| :--------------------------------------- | :----------------------------------------------------------- |
| [ISSUE.md](./ISSUE.md)                   | Issueの作成ルール、テンプレート、ラベル運用                  |
| [BRANCHING.md](./BRANCHING.md)           | ブランチ戦略、命名規則、接頭辞の種類、Gitコマンド                         |
| [COMMIT-MESSAGE.md](./COMMIT-MESSAGE.md) | コミットメッセージの書式                |
| [PR.md](./PR.md)                         | プルリクエストの作成ルール、テンプレート、マージ方式、hotfix |
| [CODING-STYLE.md](./CODING-STYLE.md)     | 命名、実装、エラーハンドリング、型安全性、セキュリティ       |
| [AI-GUIDELINES.md](./AI-GUIDELINES.md)   | AIアシスタント利用時の権限・安全ルール                       |

## 基本フロー

1. **Issue を作成する** → [ISSUE.md](./ISSUE.md)
2. **作業ブランチを切る** → [BRANCHING.md](./BRANCHING.md)
3. **コーディングする** → [CODING-STYLE.md](./CODING-STYLE.md)
   - AIアシスタントを使う場合は [AI-GUIDELINES.md](./AI-GUIDELINES.md) に従う
4. **コミットする** → [COMMIT-MESSAGE.md](./COMMIT-MESSAGE.md)
5. **PR を作成してレビュー・マージする** → [PR.md](./PR.md)
   - `main` にマージするPRの本文には `Closes #Issue番号`、それ以外は `Refs #Issue番号` と書く（[書き方](./PR.md#関連issueの書き方)）。
   - 大きな変更は、小さなPRに分けて出せる（[PR.md](./PR.md#4-大きな変更を分けて出す方法適材適所)）。
   - 本番の緊急バグ修正は、[hotfix の手順](./PR.md#7-hotfix本番の緊急バグ修正)に従う。
6. **作業ブランチを削除する** → [BRANCHING.md](./BRANCHING.md)
