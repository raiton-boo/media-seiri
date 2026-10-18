/**
 * 単一の実行ファイル(`dist/seiri`)を作る。
 *   bun scripts/build-binary.ts [--skip-web] [--outfile <パス>]
 * 1. 画面(`packages/viewer/web/out`)を作る(`--skip-web` で、省く)
 * 2. 画面のファイルと、ExifTool(perl 版)の一覧を、`packages/cli/src/embedded/assets.generated.ts` に書く
 * 3. `bun build --compile` で、実行ファイルにする
 * 地名データ(`cities.tsv`)は、`core` が、テキストとして取り込んでいるので、自動で入る。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const webOut = join(root, 'packages/viewer/web/out');
const generated = join(root, 'packages/cli/src/embedded/assets.generated.ts');
const entry = join(root, 'packages/cli/src/main-compiled.ts');

const args = process.argv.slice(2);
const skipWeb = args.includes('--skip-web');
const outIndex = args.indexOf('--outfile');
const outfile = resolve(
  outIndex >= 0 ? (args[outIndex + 1] ?? '') : join(root, 'dist/seiri')
);

const run = async (command: string[], cwd = root): Promise<void> => {
  const process_ = Bun.spawn(command, {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await process_.exited) !== 0) {
    throw new Error(`失敗しました: ${command.join(' ')}`);
  }
};

const walk = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? walk(join(directory, item.name))
      : [join(directory, item.name)]
  );

/** ExifTool(perl 版)の場所。`exiftool-vendored.pl` の `bin/` の 1 つ上 */
const findExiftool = (): { dir: string; version: string } => {
  const base = join(root, 'node_modules/.bun');
  const found = readdirSync(base).find((name) =>
    name.startsWith('exiftool-vendored.pl@')
  );
  if (!found)
    throw new Error(
      'exiftool-vendored.pl が見つかりません(bun install をしてください)'
    );
  const dir = join(base, found, 'node_modules/exiftool-vendored.pl');
  const version = (
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  return { dir, version };
};

if (!skipWeb)
  await run(['bun', 'run', '--filter', '@file-seiri/viewer', 'build:web']);
if (!existsSync(join(webOut, 'index.html'))) {
  throw new Error(`画面が、ありません: ${webOut}(--skip-web を外してください)`);
}

const exiftool = findExiftool();
const lines: string[] = [
  '// 自動で作るファイル(scripts/build-binary.ts)。手で編集しない。コミットしない。',
];
const webEntries: string[] = [];
const exiftoolEntries: string[] = [];
let counter = 0;
const embed = (absolute: string, key: string, into: string[]): void => {
  counter += 1;
  const name = `asset${counter}`;
  lines.push(
    `import ${name} from ${JSON.stringify(absolute)} with { type: 'file' };`
  );
  into.push(`  ${JSON.stringify(key)}: ${name},`);
};
for (const file of walk(webOut)) {
  embed(file, `/${relative(webOut, file).split('\\').join('/')}`, webEntries);
}
const exiftoolRoot = join(exiftool.dir, 'bin');
// 動かすのに要るのは、`exiftool` 本体と `lib/` だけ(設定の例・変更履歴などは、入れない)
const exiftoolFilesToEmbed = [
  join(exiftoolRoot, 'exiftool'),
  ...walk(join(exiftoolRoot, 'lib')),
];
for (const file of exiftoolFilesToEmbed) {
  embed(
    file,
    `bin/${relative(exiftoolRoot, file).split('\\').join('/')}`,
    exiftoolEntries
  );
}
lines.push(
  '',
  `export const exiftoolVersion = ${JSON.stringify(exiftool.version)};`
);
lines.push(
  'export const webFiles: Record<string, string> = {',
  ...webEntries,
  '};'
);
lines.push(
  'export const exiftoolFiles: Record<string, string> = {',
  ...exiftoolEntries,
  '};',
  ''
);
writeFileSync(generated, lines.join('\n'));
console.log(
  `埋め込む: 画面 ${webEntries.length} 件 / ExifTool ${exiftoolEntries.length} 件`
);

// Ink が、開発用に読む `react-devtools-core` は、実行ファイルには要らない(`DEV=true` のときだけ使う)ので、空のものに差し替える
const result = await Bun.build({
  entrypoints: [entry],
  compile: { outfile },
  plugins: [
    {
      name: 'stub-react-devtools',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default {};',
          loader: 'js',
        }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('実行ファイルを作れませんでした');
}
console.log(`作りました: ${outfile}`);
