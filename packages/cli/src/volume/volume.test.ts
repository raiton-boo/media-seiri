import { describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { buildVolumeInfo, normalizeFsType, parseDf } from './parse.ts';
import { recordVolume } from './record.ts';
import {
  type CommandRunner,
  isSameVolume,
  relativeToVolume,
  resolveVolume,
} from './resolve.ts';
import type { VolumeInfo } from './types.ts';

// 実機の出力と同じ形。固有 ID・名前は、ダミー
const DF_DATA = `Filesystem   512-blocks      Used  Available Capacity  Mounted on
/dev/disk3s5 1942597960 702000312 1172576656    38%    /System/Volumes/Data
`;
const DF_EXFAT_KIB = `Filesystem   1024-blocks    Used Available Capacity  Mounted on
/dev/disk5s2 1953436800   15360 1953421440     1%    /Volumes/Photo Lib
`;

const DISKUTIL_EXFAT = {
  VolumeName: 'Photo Lib',
  VolumeUUID: 'AAAAAAAA-0000-0000-0000-000000000001',
  FilesystemType: 'exfat',
  FilesystemName: 'ExFAT',
  WritableVolume: true,
  Internal: false,
  BusProtocol: 'USB',
};
const DISKUTIL_FAT32 = {
  VolumeName: 'STICK',
  VolumeUUID: 'AAAAAAAA-0000-0000-0000-000000000002',
  FilesystemType: 'msdos',
  FilesystemName: 'MS-DOS FAT32',
  WritableVolume: true,
  Internal: false,
  BusProtocol: 'USB',
};
const DISKUTIL_DATA = {
  VolumeName: 'Macintosh HD - Data',
  VolumeUUID: 'AAAAAAAA-0000-0000-0000-000000000003',
  FilesystemType: 'apfs',
  FilesystemName: 'APFS',
  WritableVolume: true,
  Internal: true,
  SolidState: true,
  BusProtocol: 'Apple Fabric',
};

describe('parseDf', () => {
  test('デバイス・容量(KiB を、バイトに)・空き・マウント先(空白を含む)を読む', () => {
    expect(parseDf(DF_EXFAT_KIB)).toEqual({
      deviceNode: '/dev/disk5s2',
      totalBytes: 1_953_436_800 * 1024,
      freeBytes: 1_953_421_440 * 1024,
      mountPoint: '/Volumes/Photo Lib',
    });
  });

  test('解析できない出力は、エラー', () => {
    expect(() => parseDf('')).toThrow(CliError);
    expect(() => parseDf('Filesystem\nbroken line')).toThrow(CliError);
  });
});

describe('normalizeFsType', () => {
  test('diskutil の名前を、台帳の名前にそろえる', () => {
    expect(normalizeFsType('msdos', 'MS-DOS FAT32')).toBe('fat32');
    expect(normalizeFsType('msdos', 'MS-DOS FAT16')).toBe('fat16');
    expect(normalizeFsType('msdos', 'MS-DOS')).toBe('fat');
    expect(normalizeFsType('exfat', 'ExFAT')).toBe('exfat');
    expect(normalizeFsType('ufsd_NTFS', 'Windows NT File System')).toBe('ntfs');
    expect(normalizeFsType('ntfs', 'NTFS')).toBe('ntfs');
    expect(normalizeFsType('APFS', 'APFS')).toBe('apfs');
  });
});

describe('buildVolumeInfo', () => {
  const df = parseDf(DF_EXFAT_KIB);

  test('外付けの exFAT: 固有 ID・形式・USB・書き込み可', () => {
    expect(buildVolumeInfo(DISKUTIL_EXFAT, df)).toEqual({
      volumeUuid: 'AAAAAAAA-0000-0000-0000-000000000001',
      label: 'Photo Lib',
      fsType: 'exfat',
      mountPoint: '/Volumes/Photo Lib',
      rootPath: '/Volumes/Photo Lib',
      deviceNode: '/dev/disk5s2',
      isWritable: true,
      isInternal: false,
      mediaKind: 'usb',
      totalBytes: df.totalBytes,
      freeBytes: df.freeBytes,
    });
  });

  test('FAT32 は fat32。読み取り専用は isWritable が false', () => {
    const info = buildVolumeInfo(
      { ...DISKUTIL_FAT32, WritableVolume: false },
      df
    );
    expect(info.fsType).toBe('fat32');
    expect(info.isWritable).toBe(false);
  });

  test('内蔵の Data ボリュームは、根が /、種類は ssd', () => {
    const info = buildVolumeInfo(DISKUTIL_DATA, parseDf(DF_DATA));
    expect(info.mountPoint).toBe('/System/Volumes/Data');
    expect(info.rootPath).toBe('/');
    expect(info.isInternal).toBe(true);
    expect(info.mediaKind).toBe('ssd');
  });

  test('種類: SolidState が false なら hdd、どちらもなければ undefined', () => {
    const internal = { ...DISKUTIL_DATA, BusProtocol: 'SATA' };
    expect(
      buildVolumeInfo({ ...internal, SolidState: false }, df).mediaKind
    ).toBe('hdd');
    const { SolidState: _unused, ...unknown } = internal;
    expect(buildVolumeInfo(unknown, df).mediaKind).toBeUndefined();
  });

  test('固有 ID がないボリューム(ネットワークなど)は、エラー', () => {
    const { VolumeUUID: _unused, ...withoutUuid } = DISKUTIL_EXFAT;
    expect(() => buildVolumeInfo(withoutUuid, df)).toThrow('固有 ID');
    expect(() =>
      buildVolumeInfo({ ...DISKUTIL_EXFAT, VolumeUUID: '' }, df)
    ).toThrow(CliError);
    expect(() => buildVolumeInfo('x', df)).toThrow(CliError);
  });

  test('名前がなくても、作れる(label は空)', () => {
    const { VolumeName: _unused, ...unnamed } = DISKUTIL_EXFAT;
    expect(buildVolumeInfo(unnamed, df).label).toBe('');
  });
});

describe('resolveVolume(外のコマンドを差し替えて)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-vol-'));
  const realDir = realpathSync(dir);

  const runnerFor = (
    diskutil: unknown,
    df: string
  ): { runner: CommandRunner; calls: string[][] } => {
    const calls: string[][] = [];
    const runner: CommandRunner = (command, stdin) => {
      calls.push([...command]);
      if (command[0] === 'df') return { ok: true, stdout: df, stderr: '' };
      if (command[0] === 'diskutil')
        return { ok: true, stdout: '<plist/>', stderr: '' };
      // plutil: 標準入力(diskutil の出力)を、JSON にする
      expect(stdin).toBe('<plist/>');
      return { ok: true, stdout: JSON.stringify(diskutil), stderr: '' };
    };
    return { runner, calls };
  };

  test('df → diskutil(デバイス)→ plutil の順に呼び、実体のパスで調べる', () => {
    const { runner, calls } = runnerFor(DISKUTIL_EXFAT, DF_EXFAT_KIB);
    const info = resolveVolume(dir, runner, 'darwin');
    expect(info.volumeUuid).toBe('AAAAAAAA-0000-0000-0000-000000000001');
    expect(calls).toEqual([
      ['df', '-Pk', realDir],
      ['diskutil', 'info', '-plist', '/dev/disk5s2'],
      ['plutil', '-convert', 'json', '-o', '-', '-'],
    ]);
  });

  test('macOS 以外は、エラー', () => {
    expect(() => resolveVolume(dir, runnerFor({}, '').runner, 'linux')).toThrow(
      'macOS'
    );
  });

  test('コマンドが失敗したら、メッセージつきのエラー', () => {
    const failing: CommandRunner = () => ({
      ok: false,
      stdout: '',
      stderr: 'no such device',
    });
    expect(() => resolveVolume(dir, failing, 'darwin')).toThrow(
      'no such device'
    );
  });

  test('plutil の出力が JSON でなければ、エラー', () => {
    const runner: CommandRunner = (command) => ({
      ok: true,
      stdout: command[0] === 'df' ? DF_EXFAT_KIB : 'not json',
      stderr: '',
    });
    expect(() => resolveVolume(dir, runner, 'darwin')).toThrow('JSON');
  });

  test('ないパスは、エラー', () => {
    expect(() =>
      resolveVolume(join(dir, 'none'), runnerFor({}, '').runner, 'darwin')
    ).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

const VOLUME: VolumeInfo = {
  ...buildVolumeInfo(DISKUTIL_EXFAT, parseDf(DF_EXFAT_KIB)),
};

describe('relativeToVolume・isSameVolume', () => {
  test('ボリュームの根からの、相対パス(/ 区切り)', () => {
    expect(
      relativeToVolume(VOLUME, '/Volumes/Photo Lib/DCIM/100/IMG_0001.JPG')
    ).toBe('DCIM/100/IMG_0001.JPG');
  });

  test('内蔵の Data ボリュームは、/ から', () => {
    const data = buildVolumeInfo(DISKUTIL_DATA, parseDf(DF_DATA));
    expect(relativeToVolume(data, '/Users/me/Pictures/a.jpg')).toBe(
      'Users/me/Pictures/a.jpg'
    );
  });

  test('ボリュームの外・相対パスは、エラー', () => {
    expect(() => relativeToVolume(VOLUME, '/Volumes/Other/a.jpg')).toThrow(
      '外'
    );
    expect(() => relativeToVolume(VOLUME, '/Volumes/Photo Lib2/a.jpg')).toThrow(
      '外'
    );
    expect(() => relativeToVolume(VOLUME, 'DCIM/a.jpg')).toThrow('絶対パス');
  });

  test('同じボリュームかは、名前ではなく、固有 ID で比べる', () => {
    expect(isSameVolume(VOLUME, { ...VOLUME, label: '別の名前' })).toBe(true);
    expect(
      isSameVolume(VOLUME, {
        ...VOLUME,
        volumeUuid: 'AAAAAAAA-0000-0000-0000-00000000FFFF',
      })
    ).toBe(false);
  });
});

describe('recordVolume', () => {
  test('台帳に記録する。同じ固有 ID なら、同じ行', () => {
    const ledger = openLedger(':memory:', { libraryId: 'abc' });
    const first = recordVolume(
      ledger.db,
      VOLUME,
      new Date('2026-10-18T00:00:00Z')
    );
    const second = recordVolume(
      ledger.db,
      { ...VOLUME, label: '' },
      new Date('2026-10-18T01:00:00Z')
    );
    expect(second.volumeId).toBe(first.volumeId);
    expect(second).toMatchObject({
      label: 'Photo Lib',
      fsType: 'exfat',
      mediaKind: 'usb',
      lastSeenAt: '2026-10-18T01:00:00.000Z',
    });
    ledger.close();
  });
});

// この Mac の、実際のボリュームで確かめる(macOS だけ)
describe.skipIf(process.platform !== 'darwin')(
  'resolveVolume(この Mac の実際のボリューム)',
  () => {
    test('一時フォルダのボリューム: 固有 ID・書き込み可・容量・相対パス', () => {
      const dir = mkdtempSync(join(tmpdir(), 'file-seiri-real-'));
      try {
        const info = resolveVolume(dir);
        expect(info.volumeUuid).toMatch(
          /^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/
        );
        expect(info.isWritable).toBe(true);
        expect(info.totalBytes).toBeGreaterThan(info.freeBytes);
        expect(info.freeBytes).toBeGreaterThan(0);
        const rel = relativeToVolume(info, join(realpathSync(dir), 'a.jpg'));
        expect(rel.endsWith('/a.jpg')).toBe(true);
        expect(rel.startsWith('/')).toBe(false);
        // 同じ場所を 2 度調べると、同じボリューム
        expect(isSameVolume(info, resolveVolume(dir))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
);
