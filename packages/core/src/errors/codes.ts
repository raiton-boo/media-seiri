import type { LogLevel } from './level.ts';

/** エラーの分類(仕様書 §14)。コードは、台帳の `errors.code` に記録する */
export const ERROR_CODES = [
  { code: 'READ_FAILED', description: '読み取りに失敗した', level: 'ERROR' },
  { code: 'EMPTY_FILE', description: '空ファイル', level: 'ERROR' },
  // 破損を検出したが、修復は行っていない(dry-run、ツールが使えない、試行の上限超過)
  {
    code: 'CORRUPTED',
    description: '破損を検出した(修復は行っていない)',
    level: 'ERROR',
  },
  {
    code: 'REPAIR_FAILED',
    description: '修復を試みたが失敗した(修復も不可)',
    level: 'ERROR',
  },
  {
    code: 'HASH_MISMATCH',
    description: 'コピー後のハッシュが一致しない',
    level: 'ERROR',
  },
  {
    code: 'COPY_FAILED',
    description: '書き込みに失敗した(容量不足など)',
    level: 'ERROR',
  },
  // 深さを超えた ZIP は、開かずに、警告として記録する
  {
    code: 'ZIP_DEPTH_EXCEEDED',
    description: 'ZIP の入れ子が深さ3を超えた',
    level: 'WARN',
  },
  // 同じ名前のファイルが、ZIP の中に複数あるときは、名前に連番を付けて、すべて取り込む(警告)
  {
    code: 'ZIP_DUPLICATE_ENTRY',
    description: 'ZIP の中に、同じ名前のファイルが複数ある',
    level: 'WARN',
  },
  {
    code: 'ZIP_UNSAFE_PATH',
    description: 'ZIP 内のパスが危険',
    level: 'ERROR',
  },
  { code: 'ZIP_ENCRYPTED', description: '暗号化された ZIP', level: 'ERROR' },
  {
    code: 'METADATA_INVALID',
    description: 'メタデータが不正で読めない',
    level: 'ERROR',
  },
  {
    code: 'DEST_NOT_WRITABLE',
    description: '保存先が書き込めない',
    level: 'ERROR',
  },
  {
    code: 'DEST_FORMAT_UNSUPPORTED',
    description: '保存先の形式が不適切',
    level: 'ERROR',
  },
  {
    code: 'CAPACITY_SHORTAGE',
    description: '保存先の空きが足りない',
    level: 'ERROR',
  },
  {
    code: 'VERIFY_MISMATCH',
    description: '`verify` で台帳と一致しない',
    level: 'ERROR',
  },
] as const satisfies readonly {
  code: string;
  description: string;
  level: LogLevel;
}[];

export type ErrorCode = (typeof ERROR_CODES)[number]['code'];

const CODE_SET: ReadonlySet<string> = new Set(
  ERROR_CODES.map((entry) => entry.code)
);

/** 文字列が、エラーコードか(台帳から読んだ値の検査に使う) */
export const isErrorCode = (value: string): value is ErrorCode =>
  CODE_SET.has(value);

/** エラーコードの、ログのレベルと説明 */
export const describeError = (
  code: ErrorCode
): { description: string; level: LogLevel } => {
  const entry = ERROR_CODES.find((candidate) => candidate.code === code);
  if (!entry) throw new Error(`未知のエラーコード: ${code}`);
  return { description: entry.description, level: entry.level };
};
