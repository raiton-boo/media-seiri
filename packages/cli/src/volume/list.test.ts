import { describe, expect, test } from 'bun:test';
import { CliError } from '../cli-error.ts';
import { isListedVolume, listMountedVolumes } from './list.ts';
import { parseDfAll } from './parse.ts';
import type { CommandRunner } from './resolve.ts';
import type { VolumeInfo } from './types.ts';

// 実機の出力と同じ形(固有 ID・名前は、ダミー)
const DF_ALL = `Filesystem   1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s1s1   971299000  13000000 584000000       3%  /
devfs                  200       200         0     100%  /dev
/dev/disk3s6   971299000   2000000 584000000       1%  /System/Volumes/VM
/dev/disk3s5   971299000 380000000 584000000      40%  /System/Volumes/Data
/dev/disk3s3   971299000   1800000 584000000       1%  /Volumes/Recovery
/dev/disk5s2  1953436800     15360 1953421440       1%  /Volumes/Photo Lib
/dev/disk4s1    15139000   5600000   9339000      38%  /Volumes/STICK
map auto_home            0         0         0     100%  /System/Volumes/Data/home
`;

const base = {
  FilesystemType: 'apfs',
  FilesystemName: 'APFS',
  WritableVolume: true,
  Internal: true,
  BusProtocol: 'Apple Fabric',
};
const DISKUTIL: Record<string, Record<string, unknown>> = {
  '/dev/disk3s1s1': {
    ...base,
    VolumeName: 'Macintosh HD',
    VolumeUUID: 'U-ROOT',
    WritableVolume: false,
    SolidState: true,
  },
  '/dev/disk3s6': {
    ...base,
    VolumeName: 'VM',
    VolumeUUID: 'U-VM',
    SolidState: true,
  },
  '/dev/disk3s5': {
    ...base,
    VolumeName: 'Macintosh HD - Data',
    VolumeUUID: 'U-DATA',
    SolidState: true,
  },
  '/dev/disk3s3': { ...base, VolumeName: 'Recovery', VolumeUUID: 'U-RECOVERY' },
  '/dev/disk5s2': {
    VolumeName: 'Photo Lib',
    VolumeUUID: 'U-PHOTO',
    FilesystemType: 'exfat',
    FilesystemName: 'ExFAT',
    WritableVolume: true,
    Internal: false,
    BusProtocol: 'USB',
  },
  '/dev/disk4s1': {
    VolumeName: 'STICK',
    VolumeUUID: 'U-STICK',
    FilesystemType: 'msdos',
    FilesystemName: 'MS-DOS FAT32',
    WritableVolume: false,
    Internal: false,
    BusProtocol: 'USB',
  },
};

const runner: CommandRunner = (command, stdin) => {
  if (command[0] === 'df') return { ok: true, stdout: DF_ALL, stderr: '' };
  if (command[0] === 'diskutil') {
    const info = DISKUTIL[command[3] ?? ''];
    return info
      ? { ok: true, stdout: JSON.stringify(info), stderr: '' }
      : { ok: false, stdout: '', stderr: 'no such disk' };
  }
  // plutil: 標準入力が、すでに JSON(上の diskutil の出力の代わり)
  return { ok: true, stdout: stdin ?? '', stderr: '' };
};

describe('parseDfAll', () => {
  test('ディスクのデバイスの行だけを、すべて読む(devfs・map・ヘッダーは、除く)。マウント先の空白も読む', () => {
    const rows = parseDfAll(DF_ALL);
    expect(rows.map((row) => row.mountPoint)).toEqual([
      '/',
      '/System/Volumes/VM',
      '/System/Volumes/Data',
      '/Volumes/Recovery',
      '/Volumes/Photo Lib',
      '/Volumes/STICK',
    ]);
    expect(rows[4]).toEqual({
      deviceNode: '/dev/disk5s2',
      totalBytes: 1_953_436_800 * 1024,
      freeBytes: 1_953_421_440 * 1024,
      mountPoint: '/Volumes/Photo Lib',
    });
    expect(parseDfAll('')).toEqual([]);
  });
});

describe('listMountedVolumes', () => {
  test('外付けと、内蔵のデータのボリュームだけ。システム用・Recovery は除く。データが先、残りは名前順', () => {
    const volumes = listMountedVolumes(runner, 'darwin');
    expect(volumes.map((v) => v.label)).toEqual([
      'Macintosh HD - Data',
      'Photo Lib',
      'STICK',
    ]);
    const [data, photo, stick] = volumes;
    expect(data).toMatchObject({
      rootPath: '/',
      isInternal: true,
      mediaKind: 'ssd',
      fsType: 'apfs',
    });
    expect(photo).toMatchObject({
      fsType: 'exfat',
      mediaKind: 'usb',
      isWritable: true,
      isInternal: false,
    });
    expect(stick).toMatchObject({ fsType: 'fat32', isWritable: false });
  });

  test('固有 ID がないボリュームは、一覧に載せない(ほかは、続ける)', () => {
    const noUuid: CommandRunner = (command, stdin) => {
      if (command[0] === 'diskutil' && command[3] === '/dev/disk4s1') {
        return {
          ok: true,
          stdout: JSON.stringify({
            VolumeName: 'NET',
            Internal: false,
            FilesystemType: 'smbfs',
          }),
          stderr: '',
        };
      }
      return runner(command, stdin);
    };
    expect(listMountedVolumes(noUuid, 'darwin').map((v) => v.label)).toEqual([
      'Macintosh HD - Data',
      'Photo Lib',
    ]);
  });

  test('diskutil が失敗したデバイスは、飛ばす。df の失敗・macOS 以外は、エラー', () => {
    const flaky: CommandRunner = (command, stdin) =>
      command[0] === 'diskutil' && command[3] === '/dev/disk5s2'
        ? { ok: false, stdout: '', stderr: 'x' }
        : runner(command, stdin);
    expect(listMountedVolumes(flaky, 'darwin').map((v) => v.label)).toEqual([
      'Macintosh HD - Data',
      'STICK',
    ]);
    expect(() =>
      listMountedVolumes(
        () => ({ ok: false, stdout: '', stderr: 'boom' }),
        'darwin'
      )
    ).toThrow('df');
    expect(() => listMountedVolumes(runner, 'linux')).toThrow(CliError);
  });

  test('isListedVolume: 外付け・データのボリュームだけ', () => {
    const volume = (overrides: Partial<VolumeInfo>): VolumeInfo => ({
      volumeUuid: 'U',
      label: 'V',
      fsType: 'apfs',
      mountPoint: '/Volumes/V',
      rootPath: '/Volumes/V',
      deviceNode: '/dev/x',
      isWritable: true,
      isInternal: true,
      mediaKind: undefined,
      totalBytes: 1,
      freeBytes: 1,
      ...overrides,
    });
    expect(isListedVolume(volume({ isInternal: false }))).toBe(true);
    expect(isListedVolume(volume({ mountPoint: '/System/Volumes/Data' }))).toBe(
      true
    );
    expect(isListedVolume(volume({}))).toBe(false);
  });
});
