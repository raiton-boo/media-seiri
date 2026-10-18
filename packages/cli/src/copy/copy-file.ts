import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { toMtimeMs } from '@file-seiri/core';
import { SourceChangedError } from '../hash/index.ts';
import { CopyError, DestinationExistsError } from './errors.ts';
import { disableCache, renameExclusive } from './native.ts';

/** 読み書きの単位。4〜64 MiB で差がなかった(PoC #3) */
export const COPY_CHUNK_BYTES = 4 * 1024 * 1024;

const PART_SUFFIX = '.part';
const APPLE_DOUBLE_PREFIX = '._';

/** 一時ファイルの名前: 正式名と同じフォルダの `.<名前>.part` */
export const partPathOf = (destinationPath: string): string =>
  join(dirname(destinationPath), `.${basename(destinationPath)}${PART_SUFFIX}`);

/** macOS が、exFAT・FAT32 に、書いたファイルごとに作る付属ファイルの名前 */
const appleDoublePathOf = (path: string): string =>
  join(dirname(path), `${APPLE_DOUBLE_PREFIX}${basename(path)}`);

export type CopyRequest = {
  sourcePath: string;
  /** 正式な名前(絶対パス)。フォルダがなければ、作る */
  destinationPath: string;
  /** スキャン(とキャッシュ)で知っていること。読んでいる間に、変わっていないかの確認に使う */
  expected: { sizeBytes: number; mtimeMs: number; hash?: string };
  /** exFAT・FAT32 の保存先なら true(正式名にしたあと、`._名前` を消す) */
  removeAppleDouble: boolean;
  chunkBytes?: number;
  /** テストで、失敗や破損を注入するための、差し込み口 */
  hooks?: CopyHooks;
};

export type CopyHooks = {
  /** 1 つのチャンクを、保存先に書いたあと(書き込みの失敗の注入) */
  afterChunkWritten?: (totalBytes: number) => void;
  /** `fsync` のあと、検証の前(保存先の破損・ソースの書き換えの注入) */
  afterSync?: (paths: { sourcePath: string; partPath: string }) => void;
  /** 正式名にしたあと(付属ファイルの作成の再現) */
  afterRename?: (destinationPath: string) => void;
};

export type CopyResult = {
  /** ソースのハッシュ(SHA-256。16 進)。保存先を読み直して、一致を確かめた値 */
  hash: string;
  sizeBytes: number;
};

const removeQuietly = (path: string): void => {
  rmSync(path, { force: true });
};

const writeFully = async (
  handle: FileHandle,
  buffer: Buffer,
  length: number
): Promise<void> => {
  let offset = 0;
  while (offset < length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      length - offset
    );
    offset += bytesWritten;
  }
};

/** 保存先のファイルを、OS のキャッシュを避けて読み直し、ハッシュを返す */
export const hashWithoutCache = async (
  path: string,
  chunkBytes: number
): Promise<string> => {
  const handle = await open(path, 'r');
  try {
    disableCache(handle.fd);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(chunkBytes);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkBytes, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
};

/** 上書きしない名前の変更。同名があれば `DestinationExistsError`。非対応の形式では、存在確認のあとで、名前を変える */
const renameWithoutOverwrite = (from: string, to: string): void => {
  const result = renameExclusive(from, to);
  if (result.ok) return;
  if (result.reason === 'exists') throw new DestinationExistsError(to);
  if (result.reason === 'unsupported') {
    // 書き込みは、ロックで 1 つの実行だけに限るため、確認と変更の間に、割り込まれない
    if (existsSync(to)) throw new DestinationExistsError(to);
    renameSync(from, to);
    return;
  }
  throw new Error(`名前を変更できませんでした(errno ${result.errno}): ${to}`);
};

/**
 * 整合性を守って、1 ファイルをコピーする(仕様書 §7)。
 * 1. 同じフォルダの一時ファイル(`.<名前>.part`)に、読みながらソースのハッシュを計算して書く(書き込みの時点から `F_NOCACHE`)
 * 2. `fsync` し、ソースが変わっていないことを確かめる
 * 3. OS のキャッシュを避けて読み直し、ソースのハッシュと比べる(不一致なら、一時ファイルを消して `HASH_MISMATCH`)
 * 4. 上書きしない方法で、正式名にする(同名があれば `DestinationExistsError`)
 * 5. exFAT・FAT32 なら、付属ファイル(`._名前`)を消す
 * 更新日は、引き継がない(コピーした時刻のまま)。ソースには、触らない。どの失敗でも、一時ファイルを残さない。
 */
export const copyVerified = async (
  request: CopyRequest
): Promise<CopyResult> => {
  const chunkBytes = request.chunkBytes ?? COPY_CHUNK_BYTES;
  const { sourcePath, destinationPath } = request;
  const partPath = partPathOf(destinationPath);

  try {
    mkdirSync(dirname(destinationPath), { recursive: true });
  } catch (error) {
    throw new CopyError(
      'COPY_FAILED',
      `保存先のフォルダを作れません: ${dirname(destinationPath)}`,
      { cause: error }
    );
  }

  let source: FileHandle;
  try {
    source = await open(sourcePath, 'r');
  } catch (error) {
    throw new CopyError('READ_FAILED', `ソースを開けません: ${sourcePath}`, {
      cause: error,
    });
  }

  let destination: FileHandle | undefined;
  let renamed = false;
  // 一時ファイルを、この実行が作ったか。前の実行の残りを、後始末で消さないため
  let ownsPart = false;
  try {
    try {
      // 'wx': 前の実行の残りがあれば、上書きせず、失敗にする(残りは、起動時の掃除で消す)
      destination = await open(partPath, 'wx', 0o644);
      ownsPart = true;
      disableCache(destination.fd);
    } catch (error) {
      throw new CopyError(
        'COPY_FAILED',
        `保存先に、一時ファイルを作れません: ${partPath}`,
        { cause: error }
      );
    }

    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(chunkBytes);
    let totalBytes = 0;
    for (;;) {
      let bytesRead: number;
      try {
        ({ bytesRead } = await source.read(buffer, 0, chunkBytes, null));
      } catch (error) {
        throw new CopyError(
          'READ_FAILED',
          `ソースを読めません: ${sourcePath}`,
          { cause: error }
        );
      }
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      try {
        await writeFully(destination, buffer, bytesRead);
        totalBytes += bytesRead;
        request.hooks?.afterChunkWritten?.(totalBytes);
      } catch (error) {
        throw new CopyError('COPY_FAILED', `保存先に書けません: ${partPath}`, {
          cause: error,
        });
      }
    }
    const sourceHash = hash.digest('hex');

    try {
      await destination.sync();
      await destination.close();
      destination = undefined;
      request.hooks?.afterSync?.({ sourcePath, partPath });
    } catch (error) {
      throw new CopyError(
        'COPY_FAILED',
        `保存先への書き込みを確定できません: ${partPath}`,
        { cause: error }
      );
    }

    // ソースが、読んでいる間に変わっていないか(サイズ・更新日・事前のハッシュ)
    const after = statSync(sourcePath);
    if (
      totalBytes !== request.expected.sizeBytes ||
      after.size !== request.expected.sizeBytes ||
      toMtimeMs(after.mtimeMs) !== toMtimeMs(request.expected.mtimeMs)
    ) {
      throw new SourceChangedError(
        sourcePath,
        'コピーの間に、サイズか更新日が変わった'
      );
    }
    if (
      request.expected.hash !== undefined &&
      request.expected.hash !== sourceHash
    ) {
      throw new SourceChangedError(
        sourcePath,
        '先に計算したハッシュと、コピーしながら計算したハッシュが違う'
      );
    }

    let verifiedHash: string;
    try {
      verifiedHash = await hashWithoutCache(partPath, chunkBytes);
    } catch (error) {
      throw new CopyError(
        'COPY_FAILED',
        `保存先を読み直せません: ${partPath}`,
        { cause: error }
      );
    }
    if (verifiedHash !== sourceHash) {
      throw new CopyError(
        'HASH_MISMATCH',
        `書いたあとのハッシュが、ソースと違います: ${destinationPath}(ソース ${sourceHash}、保存先 ${verifiedHash})`
      );
    }

    try {
      renameWithoutOverwrite(partPath, destinationPath);
    } catch (error) {
      if (error instanceof DestinationExistsError) throw error;
      throw new CopyError(
        'COPY_FAILED',
        `正式な名前にできません: ${destinationPath}`,
        { cause: error }
      );
    }
    renamed = true;
    request.hooks?.afterRename?.(destinationPath);
    if (request.removeAppleDouble) {
      removeQuietly(appleDoublePathOf(partPath));
      removeQuietly(appleDoublePathOf(destinationPath));
    }
    return { hash: sourceHash, sizeBytes: totalBytes };
  } finally {
    await source.close();
    if (destination) await destination.close().catch(() => {});
    if (ownsPart && !renamed) {
      removeQuietly(partPath);
      removeQuietly(appleDoublePathOf(partPath));
    }
  }
};
