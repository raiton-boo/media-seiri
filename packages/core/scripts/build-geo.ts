/**
 * 地名データ(`src/geo/cities.tsv`)を作る。GeoNames(https://www.geonames.org/、CC BY 4.0)の一覧から、
 * 日本は人口 5,000 以上(`cities5000.txt`)、そのほかの国は人口 15,000 以上(`cities15000.txt`)を、取り出す。
 *
 * 使い方: bun run packages/core/scripts/build-geo.ts <cities5000.txt> <cities15000.txt>
 * (一覧は、https://download.geonames.org/export/dump/ から取る。出力は、リポジトリに入れる。ビルドのときに、通信はしない)
 *
 * 列: ID ⇥ 日本語名 ⇥ 英語名(ASCII) ⇥ 緯度 ⇥ 経度 ⇥ 国コード ⇥ 地方コード ⇥ 人口
 * 日本語名は、別名の中から選ぶ: 日本は、漢字の名前(市・区・町・村で終わるものを優先)。そのほかは、カタカナの名前。なければ空。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [path5000, path15000] = process.argv.slice(2);
if (!path5000 || !path15000) {
  console.error('使い方: build-geo.ts <cities5000.txt> <cities15000.txt>');
  process.exit(2);
}

const HAN = /[一-鿿]/;
const KANA = /[぀-ヿ]/;
const KATAKANA_ONLY = /^[゠-ヿ・ー･\s]+$/;
const MUNICIPALITY_SUFFIX = /[市区町村]$/;
const PREFECTURE_SUFFIX = /[都道府県]$/;

/**
 * 日本の別名に混ざる、中国語(簡体字・繁体字)だけの字。これを含む名前は、日本語の名前として使わない
 * (Shift_JIS で書けない字を調べて、拾った)。
 */
const NON_JAPANESE_CHARS = /[戶关內丰东瀨俁吳户务岛标黑歲綠进巢]/;

const japaneseNameInJapan = (alternates: string[]): string => {
  const han = alternates.filter(
    (name) =>
      HAN.test(name) && !KANA.test(name) && !NON_JAPANESE_CHARS.test(name)
  );
  const municipal = han.filter((name) => MUNICIPALITY_SUFFIX.test(name));
  if (municipal.length > 0)
    return municipal.sort((a, b) => a.length - b.length)[0] ?? '';
  const other = han.filter((name) => !PREFECTURE_SUFFIX.test(name));
  return other.sort((a, b) => a.length - b.length)[0] ?? '';
};

const katakanaName = (alternates: string[]): string =>
  alternates.find((name) => KATAKANA_ONLY.test(name) && name.length >= 2) ?? '';

type Row = string[];
const read = (path: string): Row[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));

const lines: string[] = [];
const seen = new Set<string>();
const add = (fields: Row, japanese: boolean): void => {
  const [id, , ascii, alternates, lat, lon, , , country, , admin1] = fields;
  const population = fields[14];
  if (!id || seen.has(id) || !ascii || !lat || !lon || !country) return;
  seen.add(id);
  const alts = (alternates ?? '').split(',').filter(Boolean);
  const ja = japanese ? japaneseNameInJapan(alts) : katakanaName(alts);
  lines.push(
    [
      id,
      ja,
      ascii,
      Number(lat).toFixed(3),
      Number(lon).toFixed(3),
      country,
      admin1 ?? '',
      population ?? '0',
    ].join('\t')
  );
};

for (const fields of read(path5000)) if (fields[8] === 'JP') add(fields, true);
for (const fields of read(path15000))
  if (fields[8] !== 'JP') add(fields, false);

const out = join(import.meta.dir, '..', 'src', 'geo', 'cities.tsv');
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`${lines.length} 件を書きました: ${out}`);
