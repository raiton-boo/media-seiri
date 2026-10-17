import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { CliError } from '../cli-error.ts';
import { makeTempDir } from '../test-helpers.ts';
import {
  markerExists,
  markerPathOf,
  readMarker,
  writeMarker,
} from './marker.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

const MARKER = {
  libraryId: 'abc',
  createdAt: '2026-10-18T00:00:00.000Z',
  schemaVersion: 2,
};

describe('目印ファイル', () => {
  test('書いて、読める。なければ undefined', () => {
    const root = newDir();
    expect(markerExists(root)).toBe(false);
    expect(readMarker(root)).toBeUndefined();
    writeMarker(root, MARKER);
    expect(markerExists(root)).toBe(true);
    expect(readMarker(root)).toEqual(MARKER);
  });

  test('すでにあるときは、上書きせず、エラー', () => {
    const root = newDir();
    writeMarker(root, MARKER);
    expect(() =>
      writeMarker(root, { ...MARKER, libraryId: 'other' })
    ).toThrow();
    expect(readMarker(root)?.libraryId).toBe('abc');
  });

  test('壊れた目印は、エラー(JSON でない・項目がない・型が違う)', () => {
    const root = newDir();
    for (const content of [
      'not json',
      '{}',
      '[]',
      'null',
      JSON.stringify({ ...MARKER, libraryId: '' }),
      JSON.stringify({ ...MARKER, schemaVersion: '2' }),
      JSON.stringify({ ...MARKER, schemaVersion: 1.5 }),
      JSON.stringify({ ...MARKER, createdAt: 1 }),
    ]) {
      writeFileSync(markerPathOf(root), content);
      expect(() => readMarker(root)).toThrow(CliError);
    }
  });
});
