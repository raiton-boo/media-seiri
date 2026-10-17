/** 台帳を開くときの失敗の種類 */
export type LedgerErrorCode =
  // 台帳のスキーマが、このプログラムより新しい(新しい版で作られた台帳)
  | 'SCHEMA_TOO_NEW'
  // 読み取り専用で開いたが、スキーマが古い(移行できるのは、書き込み用で開くときだけ)
  | 'SCHEMA_NEEDS_MIGRATION'
  // `user_version` と `meta` の版が食い違っている
  | 'SCHEMA_INCONSISTENT'
  // 別のライブラリの台帳を、開こうとした
  | 'LIBRARY_ID_MISMATCH'
  // ライブラリ ID が台帳になく、指定もされていない
  | 'LIBRARY_ID_REQUIRED';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
