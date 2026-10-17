import type { ErrorCode } from '@file-seiri/core';

/**
 * コピーの失敗。`code` は、台帳の `errors.code` に記録する値(仕様書 §14)。
 * - `READ_FAILED`: ソースを読めない、または、読んでいる間に変わった
 * - `COPY_FAILED`: 保存先に書けない(容量不足・権限・読み直せない など)
 * - `HASH_MISMATCH`: 書いたあとに読み直したハッシュが、ソースと違う
 */
export class CopyError extends Error {
  readonly code: Extract<
    ErrorCode,
    'READ_FAILED' | 'COPY_FAILED' | 'HASH_MISMATCH'
  >;

  constructor(
    code: CopyError['code'],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'CopyError';
    this.code = code;
  }
}

/** 正式名と同じ名前が、すでにある。上書きせず、連番を取り直す(仕様書 §7-3) */
export class DestinationExistsError extends Error {
  constructor(path: string) {
    super(`同じ名前のファイルがすでにあります: ${path}`);
    this.name = 'DestinationExistsError';
  }
}
