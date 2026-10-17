import { describe, expect, test } from 'bun:test';
import { describeSelf } from './index.ts';

describe('cli', () => {
  test('core の関数を呼べる', () => {
    expect(describeSelf()).toBe('file-seiri/cli');
  });
});
