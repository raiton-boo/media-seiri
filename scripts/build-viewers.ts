/**
 * 閲覧専用ビューア(ドライブの `viewer/` に置く実行ファイル)を、OS・CPU ごとに作る。`dist/viewer/` にできる。
 *   bun scripts/build-viewers.ts [--only <名前の一部>]
 * 別の OS 用の実行ファイルを作るには、その OS 用の Bun の実行環境を、取得する(ネットワークが要る。2 回目からは、キャッシュ)。
 */
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const outDir = join(root, 'dist', 'viewer');

/** `build-binary.ts --viewer` の対象と、出力のファイル名(`viewer-bundle/install.ts` の `VIEWER_FILES` と、そろえる) */
const TARGETS = [
  { target: 'bun-windows-x64', name: 'seiri-viewer-windows-x64.exe' },
  { target: 'bun-darwin-arm64', name: 'seiri-viewer-macos-arm64' },
  { target: 'bun-darwin-x64', name: 'seiri-viewer-macos-x64' },
] as const;

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

const run = async (command: string[]): Promise<void> => {
  const child = Bun.spawn(command, {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0)
    throw new Error(`失敗しました: ${command.join(' ')}`);
};

// 画面は、1 回だけ作る
await run(['bun', 'run', '--filter', '@file-seiri/viewer', 'build:web']);
let built = 0;
for (const { target, name } of TARGETS) {
  if (only && !name.includes(only)) continue;
  console.log(`\n== ${name}(${target})`);
  await run([
    'bun',
    'scripts/build-binary.ts',
    '--viewer',
    '--skip-web',
    '--target',
    target,
    '--outfile',
    join(outDir, name),
  ]);
  built += 1;
}
console.log(`\n${built} 件を、作りました: ${outDir}`);
