import type { ErrorCode } from '@file-seiri/core';
import { CliError } from '../cli-error.ts';
import { isSameVolume, type VolumeInfo } from '../volume/index.ts';

/** FAT32 の、ファイル 1 つの上限(4 GiB 未満) */
const FAT32_LIMIT_BYTES = 4 * 1024 ** 3;
/** 表示(`formatBytes`)と同じ、10 進の GB */
const GB = 1000 ** 3;
/** 容量の余裕分(仕様書 §9-3。仮): 必要量の 5% と 10 GB の、大きいほう */
const MARGIN_RATIO = 0.05;
const MARGIN_MIN_BYTES = 10 * GB;

export type Problem = { code: ErrorCode; message: string };

/** 保存先とソースが、同じボリュームなら、止める(仕様書 §9-1) */
export const assertDifferentVolumes = (
  source: VolumeInfo,
  destination: VolumeInfo
): void => {
  if (isSameVolume(source, destination)) {
    throw new CliError(
      `ソースと保存先が、同じボリュームです(${destination.label || destination.volumeUuid})。別のドライブを指定してください。`
    );
  }
};

/** 保存先のボリュームの検査(仕様書 §9-2)。読み取り専用・NTFS は、スキャンの前に分かる */
export const checkDestinationVolume = (destination: VolumeInfo): Problem[] => {
  const problems: Problem[] = [];
  const name = destination.label || destination.volumeUuid;
  if (!destination.isWritable) {
    problems.push({
      code: 'DEST_NOT_WRITABLE',
      message: `保存先(${name})は、読み取り専用でマウントされています(NTFS を Mac で開いている場合など)。`,
    });
  }
  if (destination.fsType === 'ntfs') {
    problems.push({
      code: 'DEST_FORMAT_UNSUPPORTED',
      message: `保存先(${name})は NTFS です。Mac から書き込めないため、使えません(exFAT などにしてください)。`,
    });
  }
  return problems;
};

/** コピー予定に、FAT32 に入らない(4 GiB 以上の)ファイルがあるか(仕様書 §9-2) */
export const checkFat32Limit = (
  destination: VolumeInfo,
  copySizes: Iterable<number>
): Problem[] => {
  if (destination.fsType !== 'fat32') return [];
  let largest = 0;
  for (const size of copySizes) largest = Math.max(largest, size);
  if (largest < FAT32_LIMIT_BYTES) return [];
  return [
    {
      code: 'DEST_FORMAT_UNSUPPORTED',
      message: `保存先は FAT32 ですが、4 GB 以上のファイルがコピー予定にあります(最大 ${formatBytes(largest)})。`,
    },
  ];
};

export type CapacityEstimate = {
  copyBytes: number;
  marginBytes: number;
  requiredBytes: number;
  freeBytes: number;
  /** 不足分(足りていれば 0) */
  shortageBytes: number;
};

/** 必要な容量(コピー予定の合計 + 余裕分)と、保存先の空きを比べる(仕様書 §9-3) */
export const estimateCapacity = (
  copyBytes: number,
  freeBytes: number
): CapacityEstimate => {
  const marginBytes = Math.max(
    Math.ceil(copyBytes * MARGIN_RATIO),
    MARGIN_MIN_BYTES
  );
  const requiredBytes = copyBytes + marginBytes;
  return {
    copyBytes,
    marginBytes,
    requiredBytes,
    freeBytes,
    shortageBytes: Math.max(0, requiredBytes - freeBytes),
  };
};

export const capacityProblem = (
  estimate: CapacityEstimate
): Problem | undefined =>
  estimate.shortageBytes === 0
    ? undefined
    : {
        code: 'CAPACITY_SHORTAGE',
        message: `保存先の空きが足りません(必要 ${formatBytes(estimate.requiredBytes)}、空き ${formatBytes(estimate.freeBytes)}、不足 ${formatBytes(estimate.shortageBytes)})。`,
      };

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** バイト数を、読みやすい単位にする(1000 ごと) */
export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
};
