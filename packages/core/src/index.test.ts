import { describe, expect, test } from 'bun:test';
import { describePackage, PROJECT_NAME } from './index.ts';

describe('core', () => {
  test('プロジェクトの名前を返す', () => {
    expect(PROJECT_NAME).toBe('file-seiri');
  });

  test('パッケージの説明を作る', () => {
    expect(describePackage('core')).toBe('file-seiri/core');
  });
});
