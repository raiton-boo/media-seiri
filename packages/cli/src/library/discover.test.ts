import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/registry.ts';
import { makeTempDir } from '../test-helpers.ts';
import { findLibraries } from './discover.ts';
import { writeMarker } from './marker.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

const EMPTY: Config = { version: 1, libraries: {} };
const marker = (libraryId: string) => ({
  libraryId,
  createdAt: '2026-10-18T00:00:00.000Z',
  schemaVersion: 2,
});
const makeLibrary = (
  root: string,
  libraryId: string,
  snapshotAt?: Date
): void => {
  mkdirSync(join(root, '.file-seiri'), { recursive: true });
  writeMarker(root, marker(libraryId));
  if (snapshotAt) {
    const path = join(root, '.file-seiri', 'catalog.snapshot.sqlite');
    writeFileSync(path, 'x');
    utimesSync(path, snapshotAt, snapshotAt);
  }
};

describe('findLibraries', () => {
  test('ボリュームの根と、直下のフォルダの目印を見つける。最終更新は、スナップショットの更新日時', () => {
    const drive = newDir();
    const at = new Date('2026-10-17T12:34:00');
    makeLibrary(join(drive, 'Pictures'), 'lib-a', at);
    makeLibrary(drive, 'lib-root');
    mkdirSync(join(drive, 'Other'));
    const found = findLibraries({
      mountPoint: drive,
      scanRoot: drive,
      config: EMPTY,
    });
    expect(found.map((l) => [l.libraryId, l.registered])).toEqual([
      ['lib-root', false],
      ['lib-a', false],
    ]);
    expect(
      found.find((l) => l.libraryId === 'lib-a')?.lastUpdated?.getTime()
    ).toBe(at.getTime());
    expect(
      found.find((l) => l.libraryId === 'lib-root')?.lastUpdated
    ).toBeUndefined();
  });

  test('この Mac の設定に登録されているものは、registered(場所が、ボリュームの中のものだけ)', () => {
    const drive = newDir();
    const other = newDir();
    makeLibrary(join(drive, 'Pictures'), 'lib-a');
    makeLibrary(other, 'lib-elsewhere');
    const config: Config = {
      version: 1,
      libraries: {
        'lib-a': { root: join(drive, 'Pictures'), registeredAt: 't' },
        'lib-elsewhere': { root: other, registeredAt: 't' },
      },
    };
    const found = findLibraries({ mountPoint: drive, scanRoot: drive, config });
    expect(found.map((l) => [l.libraryId, l.registered])).toEqual([
      ['lib-a', true],
    ]);
  });

  test('scanRoot がなければ(内蔵のデータのボリューム)、登録されたものだけ', () => {
    const drive = newDir();
    makeLibrary(join(drive, 'Pictures'), 'lib-a');
    makeLibrary(join(drive, 'Unregistered'), 'lib-b');
    const config: Config = {
      version: 1,
      libraries: {
        'lib-a': { root: join(drive, 'Pictures'), registeredAt: 't' },
      },
    };
    expect(
      findLibraries({ mountPoint: drive, scanRoot: undefined, config }).map(
        (l) => l.libraryId
      )
    ).toEqual(['lib-a']);
  });

  test('管理用のフォルダ・隠しフォルダ・2 つ下の目印は、探さない。壊れた目印は、数えない', () => {
    const drive = newDir();
    makeLibrary(join(drive, '$RECYCLE.BIN'), 'lib-trash');
    makeLibrary(join(drive, '.hidden'), 'lib-hidden');
    makeLibrary(join(drive, 'a', 'deep'), 'lib-deep');
    mkdirSync(join(drive, 'broken'));
    writeFileSync(
      join(drive, 'broken', '.file-seiri-library.json'),
      'not json'
    );
    expect(
      findLibraries({ mountPoint: drive, scanRoot: drive, config: EMPTY })
    ).toEqual([]);
  });

  test('登録された場所に目印がなければ(消えた・別のドライブ)、数えない', () => {
    const drive = newDir();
    const config: Config = {
      version: 1,
      libraries: { x: { root: join(drive, 'Gone'), registeredAt: 't' } },
    };
    expect(
      findLibraries({ mountPoint: drive, scanRoot: undefined, config })
    ).toEqual([]);
  });
});
