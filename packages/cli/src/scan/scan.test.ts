import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CliError } from '../cli-error.ts';
import { makeTempDir } from '../test-helpers.ts';
import type { VolumeInfo } from '../volume/index.ts';
import { collectScan, type ScanEvent, scanSource } from './scan.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 一時ディレクトリを、ボリュームの根(ドライブ)に見立てる */
const setup = (): { volumeRoot: string; volume: VolumeInfo } => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  const volumeRoot = realpathSync(dir);
  return {
    volumeRoot,
    volume: {
      volumeUuid: 'AAAAAAAA-0000-0000-0000-000000000001',
      label: 'Test',
      fsType: 'exfat',
      mountPoint: volumeRoot,
      rootPath: volumeRoot,
      deviceNode: '/dev/test',
      isWritable: true,
      isInternal: false,
      mediaKind: 'usb',
      totalBytes: 1,
      freeBytes: 1,
    },
  };
};

const put = (root: string, relPath: string, content = 'x'): void => {
  const path = join(root, relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

const relPaths = (events: ScanEvent[], type: ScanEvent['type']): string[] =>
  events.flatMap((event) =>
    event.type !== type
      ? []
      : 'file' in event
        ? [event.file.relPath]
        : [event.relPath]
  );

describe('scanSource', () => {
  test('ファイルの情報(相対パス・フォルダ・拡張子・種類・サイズ・更新日)を返す', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'DCIM/100/IMG_0001.JPG', 'abcde');
    const mtime = new Date('2024-03-05T10:20:30.123Z');
    utimesSync(join(volumeRoot, 'DCIM/100/IMG_0001.JPG'), mtime, mtime);

    const { files } = collectScan({
      sourceRoot: join(volumeRoot, 'DCIM'),
      volume,
    });
    expect(files).toEqual([
      {
        absolutePath: join(volumeRoot, 'DCIM/100/IMG_0001.JPG'),
        relPath: 'DCIM/100/IMG_0001.JPG',
        directory: '100',
        fileName: 'IMG_0001.JPG',
        ext: 'jpg',
        kind: 'photo',
        sizeBytes: 5,
        mtimeMs: mtime.getTime(),
      },
    ]);
  });

  test('種類: 写真・RAW・動画・xmp・json・対象外・ZIP', () => {
    const { volumeRoot, volume } = setup();
    for (const name of [
      'a.JPG',
      'b.cr3',
      'c.mov',
      'b.xmp',
      'meta.json',
      'x.aae',
      'noext',
      'photos.zip',
      'P.ZIP',
    ]) {
      put(volumeRoot, `src/${name}`);
    }
    const kinds = Object.fromEntries(
      collectScan({ sourceRoot: join(volumeRoot, 'src'), volume }).files.map(
        (f) => [f.fileName, f.kind]
      )
    );
    expect(kinds).toEqual({
      'a.JPG': 'photo',
      'b.cr3': 'raw',
      'c.mov': 'video',
      'b.xmp': 'xmp',
      'meta.json': 'json',
      'x.aae': 'unsupported',
      noext: 'unsupported',
      'photos.zip': 'archive',
      'P.ZIP': 'archive',
    });
  });

  test('設定で足した拡張子を、使える', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/a.heics');
    const { files } = collectScan({
      sourceRoot: join(volumeRoot, 'src'),
      volume,
      additionalExtensions: new Map([['heics', 'photo']]),
    });
    expect(files[0]?.kind).toBe('photo');
  });

  test('管理用のファイル・フォルダ・._*・*.photoslibrary は、除く(フォルダの中へも入らない)', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/keep.jpg');
    put(volumeRoot, 'src/.DS_Store');
    put(volumeRoot, 'src/._IMG_0001.jpg');
    put(volumeRoot, 'src/Thumbs.db');
    put(volumeRoot, 'src/.Trashes/501/a.jpg');
    put(volumeRoot, 'src/$RECYCLE.BIN/a.jpg');
    put(volumeRoot, 'src/System Volume Information/a.jpg');
    put(volumeRoot, 'src/My.photoslibrary/originals/a.jpg');
    const events = [
      ...scanSource({ sourceRoot: join(volumeRoot, 'src'), volume }),
    ];
    expect(relPaths(events, 'file')).toEqual(['src/keep.jpg']);
    expect(relPaths(events, 'skipped').sort()).toEqual([
      'src/$RECYCLE.BIN',
      'src/.DS_Store',
      'src/.Trashes',
      'src/._IMG_0001.jpg',
      'src/My.photoslibrary',
      'src/System Volume Information',
      'src/Thumbs.db',
    ]);
  });

  test('ライブラリの根・作業用の data/ は、除く(ソースの中にあっても)', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/new.jpg');
    put(volumeRoot, 'src/Pictures/2024/05/old.jpg');
    put(volumeRoot, 'src/data/libraries/x/thumb.jpg');
    const events = [
      ...scanSource({
        sourceRoot: join(volumeRoot, 'src'),
        volume,
        excludePaths: [
          join(volumeRoot, 'src/Pictures'),
          join(volumeRoot, 'src/data'),
        ],
      }),
    ];
    expect(relPaths(events, 'file')).toEqual(['src/new.jpg']);
    expect(
      events
        .filter((e) => e.type === 'skipped')
        .map((e) => e.type === 'skipped' && e.reason)
    ).toEqual(['excluded-path', 'excluded-path']);
  });

  test('ソース自身が、除外する場所なら、エラー', () => {
    const { volumeRoot, volume } = setup();
    mkdirSync(join(volumeRoot, 'src'));
    expect(() => [
      ...scanSource({
        sourceRoot: join(volumeRoot, 'src'),
        volume,
        excludePaths: [join(volumeRoot, 'src')],
      }),
    ]).toThrow(CliError);
  });

  test('0 バイトのファイルは、空ファイルとして、区別する', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/empty.jpg', '');
    put(volumeRoot, 'src/ok.jpg', 'x');
    const summary = collectScan({
      sourceRoot: join(volumeRoot, 'src'),
      volume,
    });
    expect(summary.files.map((f) => f.fileName)).toEqual(['ok.jpg']);
    expect(summary.emptyFiles.map((f) => f.fileName)).toEqual(['empty.jpg']);
  });

  test('シンボリックリンクは、たどらない(輪にならない)', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/real/a.jpg');
    symlinkSync(join(volumeRoot, 'src'), join(volumeRoot, 'src/loop'));
    symlinkSync(
      join(volumeRoot, 'src/real/a.jpg'),
      join(volumeRoot, 'src/link.jpg')
    );
    const events = [
      ...scanSource({ sourceRoot: join(volumeRoot, 'src'), volume }),
    ];
    expect(relPaths(events, 'file')).toEqual(['src/real/a.jpg']);
    expect(relPaths(events, 'skipped').sort()).toEqual([
      'src/link.jpg',
      'src/loop',
    ]);
  });

  test('読めないフォルダは、記録して、ほかを続ける', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/a/locked/x.jpg');
    put(volumeRoot, 'src/b.jpg');
    const locked = join(volumeRoot, 'src/a/locked');
    chmodSync(locked, 0o000);
    try {
      const summary = collectScan({
        sourceRoot: join(volumeRoot, 'src'),
        volume,
      });
      expect(summary.files.map((f) => f.relPath)).toEqual(['src/b.jpg']);
      expect(summary.unreadable.map((u) => u.relPath)).toEqual([
        'src/a/locked',
      ]);
      expect(summary.unreadable[0]?.detail).toContain('EACCES');
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test('並びは、フォルダが先で、名前の順(いつも同じ)', () => {
    const { volumeRoot, volume } = setup();
    for (const name of ['z.jpg', 'a.jpg', 'm/b.jpg', 'c/d.jpg', 'B.jpg'])
      put(volumeRoot, `src/${name}`);
    const order = collectScan({
      sourceRoot: join(volumeRoot, 'src'),
      volume,
    }).files.map((f) => f.relPath);
    expect(order).toEqual([
      'src/c/d.jpg',
      'src/m/b.jpg',
      'src/B.jpg',
      'src/a.jpg',
      'src/z.jpg',
    ]);
    expect(
      collectScan({ sourceRoot: join(volumeRoot, 'src'), volume }).files.map(
        (f) => f.relPath
      )
    ).toEqual(order);
  });

  test('日本語・空白を含む名前も、そのまま', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/旅行 2024/写真 1.jpg');
    const [file] = collectScan({
      sourceRoot: join(volumeRoot, 'src'),
      volume,
    }).files;
    expect(file?.relPath).toBe('src/旅行 2024/写真 1.jpg');
    expect(file?.directory).toBe('旅行 2024');
  });

  test('ソースの直下のファイルは、フォルダが空', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/a.jpg');
    expect(
      collectScan({ sourceRoot: join(volumeRoot, 'src'), volume }).files[0]
        ?.directory
    ).toBe('');
  });

  test('ファイルを 1 つずつ返す(最初のファイルが、全体のスキャンの前に取れる)', () => {
    const { volumeRoot, volume } = setup();
    put(volumeRoot, 'src/a.jpg');
    put(volumeRoot, 'src/b.jpg');
    const first = scanSource({
      sourceRoot: join(volumeRoot, 'src'),
      volume,
    }).next();
    expect(first.done).toBe(false);
  });
});
