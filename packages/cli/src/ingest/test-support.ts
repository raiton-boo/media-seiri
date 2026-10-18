import { afterAll, beforeAll } from 'bun:test';
import { copyFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { ExifTool } from 'exiftool-vendored';
import { ledgerPathFor } from '../config/paths.ts';
import { type RunEnvironment, run } from '../run.ts';
import { makeTempDir } from '../test-helpers.ts';
import type { VolumeInfo } from '../volume/index.ts';

export const FIXTURES = join(import.meta.dir, '../metadata/fixtures');
export const NOW = new Date('2026-10-18T00:00:00.000Z');

export const makeVolume = (
  overrides: Partial<VolumeInfo> & { rootPath: string }
): VolumeInfo => ({
  volumeUuid: 'AAAAAAAA-0000-0000-0000-000000000001',
  label: 'Volume',
  fsType: 'exfat',
  mountPoint: overrides.rootPath,
  deviceNode: '/dev/test',
  isWritable: true,
  isInternal: false,
  mediaKind: 'usb',
  totalBytes: 2_000_000_000_000,
  freeBytes: 1_900_000_000_000,
  ...overrides,
});

/** テストの世界: ソースのドライブ・保存先のドライブ・作業用の領域(すべて、一時ディレクトリの中) */
export type World = {
  base: string;
  dataDir: string;
  /** ソースのドライブの根(ボリュームの根) */
  srcRoot: string;
  /** 保存先のドライブの根 */
  destDrive: string;
  /** ライブラリの根(保存先のドライブの中) */
  library: string;
  sourceVolume: VolumeInfo;
  destVolume: VolumeInfo;
  cleanup: () => void;
};

export const makeWorld = (
  options: {
    destVolume?: Partial<VolumeInfo>;
    sourceVolume?: Partial<VolumeInfo>;
  } = {}
): World => {
  const { dir, cleanup } = makeTempDir();
  const srcRoot = join(dir, 'srcdrive');
  const destDrive = join(dir, 'destdrive');
  mkdirSync(srcRoot, { recursive: true });
  mkdirSync(destDrive, { recursive: true });
  return {
    base: dir,
    dataDir: join(dir, 'data'),
    srcRoot,
    destDrive,
    library: join(destDrive, 'Pictures'),
    sourceVolume: makeVolume({
      rootPath: srcRoot,
      volumeUuid: 'SRC00000-0000-0000-0000-000000000001',
      label: 'Source',
      ...options.sourceVolume,
    }),
    destVolume: makeVolume({
      rootPath: destDrive,
      volumeUuid: 'DST00000-0000-0000-0000-000000000002',
      label: 'Library',
      ...options.destVolume,
    }),
    cleanup,
  };
};

export type CliResult = { code: number; stdout: string[]; stderr: string[] };

/** 世界の中で、コマンドを実行する(ボリュームは、パスから、差し替える) */
export const runIn = async (
  world: World,
  argv: string[],
  options: Partial<RunEnvironment> = {}
): Promise<CliResult> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['--data-dir', world.dataDir, ...argv], {
    env: {},
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    now: () => NOW,
    newLibraryId: () => 'lib-1',
    timeZone: 'Asia/Tokyo',
    isInteractive: false,
    useColor: false,
    sleep: async () => {},
    resolveVolume: (path) =>
      path.startsWith(world.srcRoot) ? world.sourceVolume : world.destVolume,
    ...options,
  });
  return { code, stdout, stderr };
};

/** ライブラリを作る(目印・台帳・設定) */
export const initLibrary = async (world: World): Promise<void> => {
  const result = await runIn(world, ['library', 'init', world.library]);
  if (result.code !== 0)
    throw new Error(`ライブラリを作れない: ${result.stderr.join('\n')}`);
};

export const openWorldLedger = (world: World) =>
  openLedger(ledgerPathFor(world.dataDir, 'lib-1'), { libraryId: 'lib-1' });

let writer: ExifTool | undefined;
/** タグの書き込みに使う ExifTool を、テストファイル全体で 1 つ持つ */
export const useExifWriter = (): void => {
  beforeAll(() => {
    writer = new ExifTool({ maxProcs: 1 });
  });
  afterAll(async () => {
    await writer?.end();
    writer = undefined;
  });
};

/** ソースに、合成の写真(32x32)を置く。`tags` を、EXIF に書く。更新日は、2000 年にそろえる */
export const addPhoto = async (
  world: World,
  relPath: string,
  tags: Record<string, string | number> = {}
): Promise<string> => {
  const path = join(world.srcRoot, relPath);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(join(FIXTURES, 'base.jpg'), path);
  if (!writer) throw new Error('useExifWriter() を、先に呼んでください');
  // 既定では、ファイルごとに違う内容にする(`ImageDescription` を、パスにする)。同じ内容にしたいときは、同じ値を渡す
  await writer.write(
    path,
    { ImageDescription: relPath, ...tags },
    { writeArgs: ['-overwrite_original'] }
  );
  utimesSync(path, 946_684_800, 946_684_800);
  return path;
};

export const addFile = (
  world: World,
  relPath: string,
  content: string | Uint8Array
): string => {
  const path = join(world.srcRoot, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  utimesSync(path, 946_684_800, 946_684_800);
  return path;
};

export const addVideo = (
  world: World,
  relPath: string,
  fixture = 'utc.mp4'
): string => {
  const path = join(world.srcRoot, relPath);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(join(FIXTURES, fixture), path);
  utimesSync(path, 946_684_800, 946_684_800);
  return path;
};

export const DATE_2024_03_05 = {
  DateTimeOriginal: '2024:03:05 10:20:30',
} as const;
