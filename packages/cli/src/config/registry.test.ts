import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { CliError } from '../cli-error.ts';
import { makeTempDir } from '../test-helpers.ts';
import {
  configPathFor,
  DATA_DIR_ENV,
  ledgerPathFor,
  resolveDataDir,
} from './paths.ts';
import { readConfig, registerLibrary } from './registry.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

describe('resolveDataDir', () => {
  test('--data-dir → 環境変数 → 既定、の順', () => {
    expect(resolveDataDir('/a', { [DATA_DIR_ENV]: '/b' })).toBe('/a');
    expect(resolveDataDir(undefined, { [DATA_DIR_ENV]: '/b' })).toBe('/b');
    expect(resolveDataDir(undefined, {}).endsWith('/data')).toBe(true);
    expect(
      resolveDataDir(undefined, { [DATA_DIR_ENV]: '' }).endsWith('/data')
    ).toBe(true);
  });

  test('台帳のパスは、data/libraries/<ID>/catalog.sqlite', () => {
    expect(ledgerPathFor('/d', 'abc')).toBe('/d/libraries/abc/catalog.sqlite');
  });
});

describe('設定(config.json)', () => {
  test('なければ、空の設定', () => {
    expect(readConfig(newDir())).toEqual({ version: 1, libraries: {} });
  });

  test('ライブラリの場所を記録して、読める。同じ ID は、場所を更新する', () => {
    const dir = newDir();
    registerLibrary(dir, 'a', { root: '/x', registeredAt: 't1' });
    registerLibrary(dir, 'b', { root: '/y', registeredAt: 't2' });
    registerLibrary(dir, 'a', { root: '/z', registeredAt: 't3' });
    expect(readConfig(dir).libraries).toEqual({
      a: { root: '/z', registeredAt: 't3' },
      b: { root: '/y', registeredAt: 't2' },
    });
  });

  test('壊れた設定は、エラー(上書きして、失わない)', () => {
    const dir = newDir();
    for (const content of [
      'nope',
      '{}',
      '{"version":2,"libraries":{}}',
      '{"version":1,"libraries":{"a":{}}}',
    ]) {
      writeFileSync(configPathFor(dir), content);
      expect(() => readConfig(dir)).toThrow(CliError);
      expect(() =>
        registerLibrary(dir, 'a', { root: '/x', registeredAt: 't' })
      ).toThrow(CliError);
    }
  });
});
