import { dlopen } from 'bun:ffi';
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// macOS の fcntl のコマンド番号。OS のキャッシュを使わない指定(<sys/fcntl.h> の F_NOCACHE)
const F_NOCACHE = 48;
const FCNTL_FAILED = -1;

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;
/** 読み書きの単位(環境変数 CHUNK_MIB で、MiB 単位に変えられる)。小さすぎると呼び出しが増え、大きすぎるとメモリを使う */
const DEFAULT_CHUNK_MIB = 4;
export const CHUNK_SIZE =
  Number(process.env.CHUNK_MIB ?? DEFAULT_CHUNK_MIB) * MIB;

const libSystem = dlopen('libSystem.B.dylib', {
  fcntl: { args: ['i32', 'i32', 'i32'], returns: 'i32' },
});

/** ファイルに対して、OS のキャッシュを使わない指定をする。失敗したら、例外にする */
export const disableCache = (fileDescriptor: number): void => {
  const result = libSystem.symbols.fcntl(fileDescriptor, F_NOCACHE, 1);
  if (result === FCNTL_FAILED) throw new Error('fcntl(F_NOCACHE) に失敗した');
};

// 実験用のファイルは、必ずこの名前のフォルダの中にだけ作る。削除も、このフォルダだけに限る
const TEMP_DIRECTORY_NAME = '.file-seiri-poc-tmp';

/** 保存先のドライブの直下に、実験用の一時フォルダを作り直す(前回の残りは、先に消す) */
export const prepareTempDirectory = (mountPath: string): string => {
  if (!mountPath.startsWith('/Volumes/')) {
    throw new Error(
      `外付けドライブ(/Volumes/ の下)だけを対象にする: ${mountPath}`
    );
  }
  const directory = join(mountPath, TEMP_DIRECTORY_NAME);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory);
  return directory;
};

/**
 * 実験用の一時フォルダを、中身ごと削除する。名前が違うフォルダは、決して消さない。
 * exFAT のドライブでは、rmSync の再帰の削除が、最初の 1 ファイルだけを消して、エラーなしで止まる
 * (試作で確認)。そのため、先に一覧を作ってから、1 つずつ消し、消えたことを確かめる。
 */
export const removeTempDirectory = (directory: string): void => {
  if (
    !directory.startsWith('/Volumes/') ||
    !directory.endsWith(`/${TEMP_DIRECTORY_NAME}`)
  ) {
    throw new Error(
      `実験用の一時フォルダではないため、削除しない: ${directory}`
    );
  }
  for (const name of readdirSync(directory)) {
    rmSync(join(directory, name), { force: true });
  }
  rmdirSync(directory);
  // macOS が、フォルダ自身の拡張属性のために作る付属ファイル(._フォルダ名)も消す
  rmSync(join(dirname(directory), `._${TEMP_DIRECTORY_NAME}`), { force: true });
  if (existsSync(directory))
    throw new Error(`一時フォルダを削除できなかった: ${directory}`);
};

/**
 * ファイルの付属ファイル(._名前)を消す。
 * macOS は、書いたファイルに拡張属性(com.apple.provenance)を付け、exFAT では、それを
 * ._名前 として保存する。放っておくと、Windows から見たとき、ファイルの数が 2 倍に見える。
 */
export const removeSidecar = (filePath: string): void => {
  rmSync(join(dirname(filePath), `._${basename(filePath)}`), { force: true });
};

export const megabytesPerSecond = (bytes: number, seconds: number): number =>
  bytes / MIB / seconds;
