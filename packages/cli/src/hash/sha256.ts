import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** 1 度に読む大きさ。大きいほど、外付けの HDD に、まとまった読み出しになる */
export const HASH_CHUNK_BYTES = 1024 * 1024;

export type HashResult = {
  /** SHA-256 の 16 進(小文字、64 文字) */
  hash: string;
  /** 読んだバイト数 */
  sizeBytes: number;
};

/** ファイルの SHA-256 を、ストリームで計算する(ファイル全体を、メモリに載せない)。読めなければ、拒否する */
export const hashFile = async (path: string): Promise<HashResult> => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const stream = createReadStream(path, { highWaterMark: HASH_CHUNK_BYTES });
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    sizeBytes += buffer.length;
  }
  return { hash: hash.digest('hex'), sizeBytes };
};

/** ハッシュを計算する関数。テストでは、差し替える */
export type Hasher = (path: string) => Promise<HashResult>;
