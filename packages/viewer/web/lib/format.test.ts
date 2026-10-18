import { describe, expect, test } from 'bun:test';
import {
  describePlace,
  estimatePace,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
  formatPeriodEnd,
  formatShortDateTime,
  shortenPath,
  splitBytes,
} from './format.ts';

describe('format', () => {
  test('formatCount: 3 桁区切り', () => {
    expect(formatCount(14820)).toBe('14,820');
    expect(formatCount(0)).toBe('0');
  });

  test('formatBytes: 10 進で、小数 1 桁(バイトは整数)', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(142_300)).toBe('142.3 KB');
    expect(formatBytes(124_300_000_000)).toBe('124.3 GB');
    expect(formatBytes(2_000_000_000_000)).toBe('2.0 TB');
    expect(splitBytes(124_300_000_000)).toEqual({ value: '124.3', unit: 'GB' });
  });

  test('formatPeriodEnd: 精度までの撮影日時から、年月を作る', () => {
    expect(formatPeriodEnd('2013-12-05T10:00:00')).toBe('2013.12');
    expect(formatPeriodEnd('2024-08')).toBe('2024.08');
    expect(formatPeriodEnd('2020')).toBe('2020');
  });

  test('formatDateTime: この PC の時刻の、分まで。読めない文字列は、そのまま', () => {
    const iso = '2026-10-10T12:40:00.000Z';
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatDateTime(iso)).toBe(
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
    expect(formatDateTime('不明')).toBe('不明');
  });

  test('describePlace: 分かる項目だけで、ドライブを説明する', () => {
    expect(describePlace('hdd', 'exfat')).toBe('HDD(exFAT)');
    expect(describePlace('ssd', null)).toBe('SSD');
    expect(describePlace(null, 'apfs')).toBe('APFS');
    expect(describePlace(null, null)).toBeNull();
  });

  test('formatDuration: 分:秒(1 時間以上は、時:分:秒)', () => {
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('00:00');
  });

  test('estimatePace: 進み・速さ・残り時間。まだコピーしていなければ、速さは測れない', () => {
    const base = {
      startedAt: '2026-10-10T00:00:00.000Z',
      total: 200,
      done: 50,
      plannedBytes: 4000,
      copiedBytes: 1000,
    };
    const now = new Date('2026-10-10T00:00:10.000Z');
    expect(estimatePace(base, now)).toEqual({
      percent: 25,
      bytesPerSecond: 100,
      remainingSeconds: 30,
    });
    expect(estimatePace({ ...base, copiedBytes: 0 }, now)).toEqual({
      percent: 25,
      bytesPerSecond: null,
      remainingSeconds: null,
    });
    expect(estimatePace({ ...base, total: 0, done: 0 }, now).percent).toBe(0);
  });

  test('shortenPath: 4 つ以上の区切りは、最後の 2 つだけ残して省く', () => {
    expect(shortenPath('DCIM/a.jpg')).toBe('DCIM/a.jpg');
    expect(shortenPath('A/B/c.jpg')).toBe('A/B/c.jpg');
    expect(shortenPath('A/B/C/d.jpg')).toBe('…/C/d.jpg');
    expect(shortenPath('/private/tmp/x/DCIM/e.jpg')).toBe('…/DCIM/e.jpg');
    // ZIP の中身(`!` の後ろ)も、区切り(`/`)で数える
    expect(shortenPath('A/B/C/z.zip ! in/f.jpg')).toBe('…/z.zip ! in/f.jpg');
  });

  test('formatShortDateTime: 月日と分まで。読めない文字列は、そのまま', () => {
    const date = new Date('2026-10-10T12:40:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(formatShortDateTime('2026-10-10T12:40:00.000Z')).toBe(
      `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
    expect(formatShortDateTime('不明')).toBe('不明');
  });
});
