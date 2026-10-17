import { CliError } from '../cli-error.ts';
import type { VolumeInfo } from './types.ts';

/** 内蔵ストレージのユーザーのデータの、マウント先。`/Users` などは、ここの中身が、`/` から見える */
const DATA_VOLUME_MOUNT_POINT = '/System/Volumes/Data';
const BYTES_PER_KIB = 1024;

export type DfResult = {
  deviceNode: string;
  totalBytes: number;
  freeBytes: number;
  mountPoint: string;
};

/** `df -Pk <パス>` の出力を解析する(2 行目が、パスのボリューム) */
export const parseDf = (output: string): DfResult => {
  const line = output.trim().split('\n')[1];
  const match = line?.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
  if (!match) throw new CliError(`df の出力を解析できません: ${output.trim()}`);
  const [, deviceNode = '', total = '0', , available = '0', mountPoint = ''] =
    match;
  return {
    deviceNode,
    totalBytes: Number(total) * BYTES_PER_KIB,
    freeBytes: Number(available) * BYTES_PER_KIB,
    mountPoint,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** `diskutil` の形式の名前を、台帳に持つ名前にそろえる */
export const normalizeFsType = (fsType: string, fsName: string): string => {
  const lower = fsType.toLowerCase();
  if (lower === 'msdos') {
    if (/fat32/i.test(fsName)) return 'fat32';
    if (/fat16/i.test(fsName)) return 'fat16';
    return 'fat';
  }
  if (lower.includes('ntfs')) return 'ntfs';
  return lower;
};

/**
 * `diskutil info -plist <デバイス>` を JSON にしたものと、`df` の結果から、ボリュームの情報を作る。
 * 固有 ID がないボリューム(ネットワークなど)は、識別できないため、エラー。
 */
export const buildVolumeInfo = (
  diskutil: unknown,
  df: DfResult
): VolumeInfo => {
  if (!isRecord(diskutil))
    throw new CliError('diskutil の出力を解析できません');
  const volumeUuid = stringOf(diskutil.VolumeUUID);
  if (!volumeUuid) {
    throw new CliError(
      `ボリュームの固有 ID を取得できません(${df.mountPoint})。このボリュームは、使えません`
    );
  }
  const bus = stringOf(diskutil.BusProtocol);
  const mediaKind =
    bus?.toUpperCase() === 'USB'
      ? ('usb' as const)
      : diskutil.SolidState === true
        ? ('ssd' as const)
        : diskutil.SolidState === false
          ? ('hdd' as const)
          : undefined;

  return {
    volumeUuid,
    label: stringOf(diskutil.VolumeName) ?? '',
    fsType: normalizeFsType(
      stringOf(diskutil.FilesystemType) ?? 'unknown',
      stringOf(diskutil.FilesystemName) ?? ''
    ),
    mountPoint: df.mountPoint,
    rootPath: df.mountPoint === DATA_VOLUME_MOUNT_POINT ? '/' : df.mountPoint,
    deviceNode: df.deviceNode,
    isWritable: diskutil.WritableVolume === true,
    isInternal: diskutil.Internal === true,
    mediaKind,
    totalBytes: df.totalBytes,
    freeBytes: df.freeBytes,
  };
};
