import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const OUTPUT_DIRECTORY = 'out';
const files: string[] = [];
// import の型を TypeScript が誤って推論する(実行時は、Bun がパスの文字列として扱う)ため、型の検査から外す
const HEADER =
  '// 自動生成のファイル(scripts/gen-assets.ts)。手で書き換えない\n// @ts-nocheck\n';

/** ディレクトリの中のファイルを、深さを問わず、全てを集める */
const collectFiles = (directory: string) => {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) collectFiles(path);
    else files.push(path);
  }
};
collectFiles(OUTPUT_DIRECTORY);

// 単体の実行ファイルに入れるには、ファイルごとに import が要る。数が多いので、自動で生成する
const imports = files.map(
  (file, index) =>
    `import file${index} from "../${file}" with { type: "file" };`
);
const entries = files.map(
  (file, index) => `  "/${relative(OUTPUT_DIRECTORY, file)}": file${index},`
);

writeFileSync(
  'src/assets.ts',
  `${HEADER}${imports.join('\n')}\nexport const assets: Record<string, string> = {\n${entries.join('\n')}\n};\n`
);

console.log(`${files.length} files`);
