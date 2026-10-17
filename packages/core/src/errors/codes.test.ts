import { describe, expect, test } from 'bun:test';
import { describeError, ERROR_CODES, isErrorCode } from './codes.ts';

describe('エラーコード(仕様書 §14)', () => {
  test('14 個のコードがあり、重複がない', () => {
    const codes = ERROR_CODES.map((entry) => entry.code);
    expect(codes).toHaveLength(14);
    expect(new Set(codes).size).toBe(14);
  });

  test('破損のコードは、CORRUPTED(修復は未実施)と REPAIR_FAILED(修復を試みて失敗)', () => {
    expect(describeError('CORRUPTED').description).toContain(
      '修復は行っていない'
    );
    expect(describeError('REPAIR_FAILED').description).toContain(
      '修復を試みたが失敗'
    );
  });

  test('WARN になるのは、ZIP_DEPTH_EXCEEDED だけ', () => {
    const warnings = ERROR_CODES.filter((entry) => entry.level === 'WARN').map(
      (entry) => entry.code
    );
    expect(warnings).toEqual(['ZIP_DEPTH_EXCEEDED']);
  });

  test('isErrorCode は、既知のコードだけを通す', () => {
    expect(isErrorCode('HASH_MISMATCH')).toBe(true);
    expect(isErrorCode('hash_mismatch')).toBe(false);
    expect(isErrorCode('UNKNOWN')).toBe(false);
  });
});
