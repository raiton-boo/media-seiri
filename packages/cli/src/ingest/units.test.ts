import { describe, expect, test } from 'bun:test';
import { mapConcurrent } from './concurrency.ts';
import {
  assertDifferentVolumes,
  capacityProblem,
  checkDestinationVolume,
  checkFat32Limit,
  estimateCapacity,
  formatBytes,
} from './preflight.ts';
import { emptySummary, formatSummary } from './summary.ts';
import { makeVolume } from './test-support.ts';

const volume = makeVolume({ rootPath: '/v' });
const GB = 1000 ** 3;

describe('mapConcurrent', () => {
  test('結果は、元の並び。同時に動くのは、上限まで', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrent(
      [5, 1, 4, 2, 3, 6],
      3,
      async (value) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, value));
        running -= 1;
        return value * 10;
      }
    );
    expect(results).toEqual([50, 10, 40, 20, 30, 60]);
    expect(peak).toBe(3);
  });

  test('空の入力・上限より少ない入力・上限 0 以下でも動く', async () => {
    expect(await mapConcurrent([], 4, async (v: number) => v)).toEqual([]);
    expect(await mapConcurrent([1, 2], 10, async (v) => v + 1)).toEqual([2, 3]);
    expect(await mapConcurrent([1, 2, 3], 0, async (v) => v)).toEqual([
      1, 2, 3,
    ]);
  });

  test('1 件でも拒否されたら、新しい項目は始めず、最初の拒否を投げる', async () => {
    const started: number[] = [];
    await expect(
      mapConcurrent([1, 2, 3, 4, 5, 6], 1, async (value) => {
        started.push(value);
        if (value === 2) throw new Error('boom');
        return value;
      })
    ).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
});

describe('preflight', () => {
  test('同じボリュームは、固有 ID で見分けて、止める', () => {
    expect(() =>
      assertDifferentVolumes(volume, { ...volume, label: 'other' })
    ).toThrow('同じボリューム');
    expect(() =>
      assertDifferentVolumes(volume, { ...volume, volumeUuid: 'OTHER' })
    ).not.toThrow();
  });

  test('保存先: 読み取り専用・NTFS は止める。exFAT・APFS は通す', () => {
    expect(checkDestinationVolume(volume)).toEqual([]);
    expect(checkDestinationVolume({ ...volume, fsType: 'apfs' })).toEqual([]);
    expect(
      checkDestinationVolume({ ...volume, isWritable: false }).map(
        (p) => p.code
      )
    ).toEqual(['DEST_NOT_WRITABLE']);
    expect(
      checkDestinationVolume({ ...volume, fsType: 'ntfs' }).map((p) => p.code)
    ).toEqual(['DEST_FORMAT_UNSUPPORTED']);
    expect(
      checkDestinationVolume({
        ...volume,
        fsType: 'ntfs',
        isWritable: false,
      }).map((p) => p.code)
    ).toEqual(['DEST_NOT_WRITABLE', 'DEST_FORMAT_UNSUPPORTED']);
  });

  test('FAT32 で 4 GiB 以上のファイルがあれば、止める(4 GiB 未満なら通す。ほかの形式は対象外)', () => {
    const fat32 = { ...volume, fsType: 'fat32' };
    const limit = 4 * 1024 ** 3;
    expect(checkFat32Limit(fat32, [10, limit - 1])).toEqual([]);
    expect(checkFat32Limit(fat32, [10, limit]).map((p) => p.code)).toEqual([
      'DEST_FORMAT_UNSUPPORTED',
    ]);
    expect(checkFat32Limit(volume, [limit * 2])).toEqual([]);
    expect(checkFat32Limit(fat32, [])).toEqual([]);
  });

  test('容量: 必要量 = コピー予定 + 余裕分(5% と 10 GB の大きいほう)', () => {
    // 小さいとき: 余裕分は 10 GB
    expect(estimateCapacity(1 * GB, 100 * GB)).toEqual({
      copyBytes: 1 * GB,
      marginBytes: 10 * GB,
      requiredBytes: 11 * GB,
      freeBytes: 100 * GB,
      shortageBytes: 0,
    });
    // 大きいとき: 5%
    expect(estimateCapacity(1000 * GB, 2000 * GB)).toMatchObject({
      marginBytes: 50 * GB,
      requiredBytes: 1050 * GB,
    });
    // 境界: 10 GB ちょうどの余裕分になるコピー量(200 GB の 5%)
    expect(estimateCapacity(200 * GB, 1000 * GB).marginBytes).toBe(10 * GB);
  });

  test('容量: 足りなければ、不足分と CAPACITY_SHORTAGE。ちょうどなら、足りる', () => {
    const exact = estimateCapacity(1 * GB, 11 * GB);
    expect(exact.shortageBytes).toBe(0);
    expect(capacityProblem(exact)).toBeUndefined();
    const short = estimateCapacity(1 * GB, 11 * GB - 1);
    expect(short.shortageBytes).toBe(1);
    expect(capacityProblem(short)?.code).toBe('CAPACITY_SHORTAGE');
    expect(capacityProblem(estimateCapacity(0, 0))?.code).toBe(
      'CAPACITY_SHORTAGE'
    );
  });

  test('formatBytes: 1000 ごとの単位', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
    expect(formatBytes(124_300_000_000)).toBe('124.3 GB');
    expect(formatBytes(1_800_000_000_000)).toBe('1.8 TB');
    expect(formatBytes(5_000_000_000_000_000)).toBe('5000.0 TB');
  });
});

describe('formatSummary', () => {
  test('件数・容量・問題を、行にする(桁区切りつき)', () => {
    const summary = emptySummary();
    summary.detected = 15610;
    summary.copyFiles = 14820;
    summary.copyBytes = 124_300_000_000;
    summary.errorsByCode = { READ_FAILED: 2 };
    summary.errorFiles = 2;
    summary.emptyFiles = 1;
    summary.capacity = estimateCapacity(summary.copyBytes, 1_200_000_000_000);
    summary.problems = [{ code: 'DEST_FORMAT_UNSUPPORTED', message: 'テスト' }];
    const text = formatSummary(summary, {
      source: 'S',
      destination: 'D',
      isDryRun: false,
    }).join('\n');
    expect(text).toContain('15,610 ファイル');
    expect(text).toContain('14,820 ファイル 124.3 GB');
    expect(text).toContain('3 ファイル (READ_FAILED 2 / EMPTY_FILE 1)');
    expect(text).toContain('問題(DEST_FORMAT_UNSUPPORTED): テスト');
    expect(text).not.toContain('[dry-run]');
    expect(text).not.toContain('処理済み');
    expect(text).not.toContain('連番を付けた');
  });

  test('処理済み・連番は、あるときだけ表示する', () => {
    const summary = emptySummary();
    summary.alreadyProcessed = 3;
    summary.sequencedGroups = 2;
    const text = formatSummary(summary, {
      source: 'S',
      destination: 'D',
      isDryRun: true,
    }).join('\n');
    expect(text).toContain('[dry-run]');
    expect(text).toContain('処理済み');
    expect(text).toContain('連番を付けた');
  });
});
