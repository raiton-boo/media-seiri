# 地名のデータ

`cities.tsv` は、写真の GPS から、近い地名(市区町村・都道府県・国)を求めるための、同梱のデータです。**実行中に、外部へ通信しません。**

## 出典とライセンス

- 出典: [GeoNames](https://www.geonames.org/)(`cities5000.txt`・`cities15000.txt`。<https://download.geonames.org/export/dump/>)
- ライセンス: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)(帰属表示が必要。このファイルが、その表示です)
- 取り出した日: 2026-10-18

## 中身

- 日本は人口 5,000 以上、そのほかの国は人口 15,000 以上の地名(約 3.5 万件、約 1.7 MB)。
- 列: ID ⇥ 日本語名 ⇥ 英語名(ASCII)⇥ 緯度 ⇥ 経度 ⇥ 国コード ⇥ 地方コード ⇥ 人口
- 日本語名は、GeoNames の別名から選んだもの(日本は漢字の名前。そのほかはカタカナの名前)。なければ、空(画面には、英語名を出す)。

## 作り直し方

```sh
curl -O https://download.geonames.org/export/dump/cities5000.zip
curl -O https://download.geonames.org/export/dump/cities15000.zip
unzip cities5000.zip && unzip cities15000.zip
bun run packages/core/scripts/build-geo.ts cities5000.txt cities15000.txt
```

作り直したら、`bun test packages/core` で、地名の選び方(`geo.test.ts`)が崩れていないかを確かめてください。
