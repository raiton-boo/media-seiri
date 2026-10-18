import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/** 単一の実行ファイルに埋め込んだ、ExifTool(perl 版)の一覧 */
type EmbeddedExiftool = {
  version: string;
  /** ExifTool のフォルダの中の相対パス → 読めるファイルの場所 */
  files: Readonly<Record<string, string>>;
};

let exiftool: EmbeddedExiftool | undefined;
let standalone = false;

/** 単一の実行ファイルとして動いているか(画面などを、埋め込んでいるか) */
export const isStandalone = (): boolean => standalone;

export const markStandalone = (): void => {
  standalone = true;
};

export const setEmbeddedExiftool = (value: EmbeddedExiftool): void => {
  exiftool = value;
};

/** 埋め込みを外す(試験用) */
export const clearEmbedded = (): void => {
  exiftool = undefined;
  standalone = false;
};

export const hasEmbeddedExiftool = (): boolean => exiftool !== undefined;

/** 実行ファイルが、展開したものを置く場所(`FILE_SEIRI_CACHE_DIR` で変えられる) */
export const cacheDir = (
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform
): string => {
  if (env.FILE_SEIRI_CACHE_DIR) return resolve(env.FILE_SEIRI_CACHE_DIR);
  return platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'file-seiri')
    : join(env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'file-seiri');
};

/** 展開が終わった印。これがあれば、中身は、そろっている */
const COMPLETE_MARK = '.complete';

/**
 * 埋め込んだ ExifTool を、キャッシュに展開して、実行する `exiftool` の場所を返す(2 回目からは、展開しない)。
 * 途中で止まっても壊れた展開が残らないよう、いったん別の名前で作ってから、置き換える。
 */
export const ensureExiftool = async (
  target: string = cacheDir()
): Promise<string> => {
  if (!exiftool) throw new Error('ExifTool が、埋め込まれていません');
  const { version, files } = exiftool;
  const finalDir = join(target, `exiftool-${version}`);
  const script = join(finalDir, 'bin', 'exiftool');
  if (existsSync(join(finalDir, COMPLETE_MARK))) return script;

  const workDir = `${finalDir}.${process.pid}.tmp`;
  rmSync(workDir, { recursive: true, force: true });
  for (const [relPath, source] of Object.entries(files)) {
    const path = resolve(workDir, relPath);
    // 一覧の名前が、展開先の外を指していても、書かない
    if (!path.startsWith(resolve(workDir) + sep)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Uint8Array(await Bun.file(source).arrayBuffer()));
  }
  chmodSync(join(workDir, 'bin', 'exiftool'), 0o755);
  writeFileSync(join(workDir, COMPLETE_MARK), '');
  rmSync(finalDir, { recursive: true, force: true });
  try {
    renameSync(workDir, finalDir);
  } catch (error) {
    // 同時に動いた別の実行が、先に置いたときは、そちらを使う
    if (!existsSync(join(finalDir, COMPLETE_MARK))) throw error;
    rmSync(workDir, { recursive: true, force: true });
  }
  return script;
};
