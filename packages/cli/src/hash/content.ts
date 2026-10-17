import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { toMtimeMs } from '@file-seiri/core';
import {
  type Content,
  findCachedContentId,
  getContent,
  getOrCreateContent,
  putHashCache,
} from '@file-seiri/ledger';
import { type Hasher, hashFile } from './sha256.ts';

/** ハッシュの計算の前後で、ソースのサイズ・更新日が変わった(コピーの途中で、書き換えられた)。再度の取り込みの対象にする */
export class SourceChangedError extends Error {
  constructor(path: string, detail: string) {
    super(`ソースが、読んでいる間に変更されました(${detail}): ${path}`);
    this.name = 'SourceChangedError';
  }
}

export type ContentRequest = {
  volumeId: number;
  /** ボリューム内の相対パス(キャッシュのキー) */
  relPath: string;
  absolutePath: string;
  /** スキャンで見た、サイズと更新日(小数のミリ秒でもよい) */
  sizeBytes: number;
  mtimeMs: number;
  /** true なら、キャッシュを使わず、計算し直す(`--rehash`) */
  rehash: boolean;
  now: () => Date;
  hasher?: Hasher;
};

export type ContentResolution = {
  content: Content;
  /** キャッシュから得た(ハッシュを計算していない) */
  fromCache: boolean;
};

/**
 * ファイルの内容(`contents` の行)を決める。
 * キャッシュにあれば、ハッシュを計算しない(サイズか更新日が違えば、キャッシュは当たらない)。
 * 計算したら、キャッシュに保存する(dry-run でも、重複判定に必要なため)。
 * 読んだバイト数や、計算のあとのサイズ・更新日が、スキャンのときと違えば、`SourceChangedError`(何も保存しない)。
 * ZIP の中身は、相対パスがキーにならないため、この関数では扱わない。
 */
export const resolveContent = async (
  db: Database,
  request: ContentRequest
): Promise<ContentResolution> => {
  const key = {
    volumeId: request.volumeId,
    relPath: request.relPath,
    sizeBytes: request.sizeBytes,
    mtimeMs: request.mtimeMs,
  };
  if (!request.rehash) {
    const contentId = findCachedContentId(db, key);
    const cached =
      contentId === undefined ? undefined : getContent(db, contentId);
    if (cached) return { content: cached, fromCache: true };
  }

  const hasher = request.hasher ?? hashFile;
  const { hash, sizeBytes } = await hasher(request.absolutePath);
  if (sizeBytes !== request.sizeBytes) {
    throw new SourceChangedError(
      request.absolutePath,
      `サイズ ${request.sizeBytes} → ${sizeBytes}`
    );
  }
  const after = statSync(request.absolutePath);
  if (
    after.size !== request.sizeBytes ||
    toMtimeMs(after.mtimeMs) !== toMtimeMs(request.mtimeMs)
  ) {
    throw new SourceChangedError(
      request.absolutePath,
      'サイズか更新日が変わった'
    );
  }

  const content = db.transaction(() => {
    const { content: saved } = getOrCreateContent(db, { hash, sizeBytes });
    putHashCache(db, key, {
      contentId: saved.contentId,
      computedAt: request.now(),
    });
    return saved;
  })();
  return { content, fromCache: false };
};
