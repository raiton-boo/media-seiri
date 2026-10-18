import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** ドライブに置く、閲覧専用ビューアの実行ファイル(OS・CPU ごと)。`bun run build:viewers` が、作る */
export const VIEWER_FILES = [
  'seiri-viewer-windows-x64.exe',
  'seiri-viewer-macos-arm64',
  'seiri-viewer-macos-x64',
] as const;

/** ライブラリの中の、置き場(`<ライブラリの根>/viewer/`) */
export const VIEWER_DIRECTORY = 'viewer';
const VERSION_FILE = '.version';
const README_FILE = 'README.txt';

const README = `閲覧専用ビューア(seiri-viewer)

このフォルダの実行ファイルを開くと、ブラウザで、写真を見られます(見るだけで、ファイルは、変えません)。

  Windows: seiri-viewer-windows-x64.exe をダブルクリック
  Mac(M1 以降): seiri-viewer-macos-arm64 を開く
  Mac(Intel): seiri-viewer-macos-x64 を開く

・ライブラリ(写真のドライブ)をつないだまま、開いてください。ライブラリは、自動で探します。
・開いたウィンドウは、見ている間、そのままにしてください。閉じると、終わります。
・内容は、最後に取り込んだ時点のものです(新しい取り込みは、Mac で行います)。
・「Windows によって PC が保護されました」と出たら、「詳細情報」→「実行」を選んでください(署名のない、自作のプログラムのため)。
`;

/** 実行ファイルの一式を、探す場所。環境変数 → 実行ファイルの隣の `viewer-bundle/` → リポジトリの `dist/viewer/`(開発) */
export const resolveBundleDir = (
  env: Record<string, string | undefined>,
  execPath: string,
  standalone: boolean,
  repoRoot: string
): string => {
  if (env.FILE_SEIRI_VIEWER_BUNDLE)
    return resolve(env.FILE_SEIRI_VIEWER_BUNDLE);
  return standalone
    ? join(dirname(execPath), 'viewer-bundle')
    : join(repoRoot, 'dist', 'viewer');
};

export type InstallResult = {
  /** 置いた(新しく・置き換えて)ファイル */
  installed: string[];
  /** すでに、同じものがあったので、そのままのファイル */
  unchanged: string[];
  /** 一式の中に、なかったファイル(作っていない) */
  missing: string[];
  directory: string;
};

const sameFile = (source: string, target: string): boolean =>
  existsSync(target) && statSync(target).size === statSync(source).size;

/**
 * 閲覧専用ビューアを、ライブラリの `viewer/` に置く(Windows の PC で、ドライブをつなげば、見られるように)。
 * 版(`.version`)と大きさが同じなら、置き直さない。途中で止まっても壊れないよう、別の名前で書いてから、置き換える。
 * 一式のフォルダ自体がなければ、`undefined`(何も、置かない)。
 */
export const installViewerBundle = (options: {
  bundleDir: string;
  libraryRoot: string;
  version: string;
}): InstallResult | undefined => {
  if (!existsSync(options.bundleDir)) return undefined;
  const directory = join(options.libraryRoot, VIEWER_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  const versionPath = join(directory, VERSION_FILE);
  const sameVersion =
    existsSync(versionPath) &&
    readFileSync(versionPath, 'utf8').trim() === options.version;

  const result: InstallResult = {
    installed: [],
    unchanged: [],
    missing: [],
    directory,
  };
  for (const name of VIEWER_FILES) {
    const source = join(options.bundleDir, name);
    if (!existsSync(source)) {
      result.missing.push(name);
      continue;
    }
    const target = join(directory, name);
    if (sameVersion && sameFile(source, target)) {
      result.unchanged.push(name);
      continue;
    }
    const temporary = join(directory, `${name}.${process.pid}.tmp`);
    try {
      copyFileSync(source, temporary);
      // exFAT などでは、効かないが、Mac の通常のドライブでは、実行できるようにする
      chmodSync(temporary, 0o755);
      rmSync(target, { force: true });
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    result.installed.push(name);
  }
  if (
    result.installed.length > 0 ||
    !existsSync(join(directory, README_FILE))
  ) {
    writeFileSync(join(directory, README_FILE), README);
    writeFileSync(versionPath, `${options.version}\n`);
  }
  return result;
};
