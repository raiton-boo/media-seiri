import { describe, expect, test } from 'bun:test';
import { isMotionEnabled, NOOP, run } from './core';

describe('motion/core', () => {
  test('ブラウザがない環境では、動かさない(動きなしと同じ)', () => {
    expect(isMotionEnabled()).toBe(false);
  });

  test('run: 対象がない・動かさない設定のときは、何もせず、戻す関数も何もしない', () => {
    let built = false;
    const cleanup = run(null, () => {
      built = true;
    });
    expect(built).toBe(false);
    expect(cleanup).toBe(NOOP);
    expect(() => cleanup()).not.toThrow();
  });
});
