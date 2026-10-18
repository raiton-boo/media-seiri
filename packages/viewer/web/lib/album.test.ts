import { describe, expect, test } from 'bun:test';
import {
  aspectClass,
  clockOf,
  eventLabel,
  eventTitle,
  formatClip,
  parseTakenAt,
  rotationOf,
  stickerColor,
  timeBand,
  weekdayOf,
} from './album.ts';

describe('album', () => {
  test('parseTakenAt: 精度 full / date の形式を、部品にする。読めなければ undefined', () => {
    expect(parseTakenAt('2014-04-06T15:32:03')).toEqual({
      year: 2014,
      month: 4,
      day: 6,
      hour: 15,
      minute: 32,
    });
    expect(parseTakenAt('2014-04-06')).toEqual({
      year: 2014,
      month: 4,
      day: 6,
      hour: undefined,
      minute: undefined,
    });
    expect(parseTakenAt('2014-04')).toBeUndefined();
    expect(parseTakenAt('不明')).toBeUndefined();
  });

  test('曜日・時間帯: 12 時前=午前、18 時前=午後、それ以降=夜', () => {
    expect(weekdayOf(2014, 4, 6)).toBe('日');
    expect(weekdayOf(2014, 4, 5)).toBe('土');
    expect([
      timeBand(0),
      timeBand(11),
      timeBand(12),
      timeBand(17),
      timeBand(18),
      timeBand(23),
    ]).toEqual(['午前', '午前', '午後', '午後', '夜', '夜']);
  });

  test('eventLabel・eventTitle: 日付と時間帯。時刻のない日付は、時間帯なし', () => {
    expect(eventLabel('2014-04-06T15:32:03')).toBe('4/6(日)午後');
    expect(eventLabel('2014-04-20')).toBe('4/20(日)');
    expect(eventTitle('2014-04-06T15:32:03')).toBe('2014年4月6日(日)午後');
    expect(eventTitle('2014-04-05T09:00:00')).toBe('2014年4月5日(土)午前');
    expect(eventLabel('壊れた')).toBe('壊れた');
  });

  test('clockOf: 時刻(HH:mm)。時刻がなければ、空', () => {
    expect(clockOf('2014-04-06T05:02:00')).toBe('05:02');
    expect(clockOf('2014-04-06')).toBe('');
    expect(clockOf(null)).toBe('');
  });

  test('aspectClass: 縦横の比率から、枠を選ぶ。分からなければ 4:3', () => {
    expect(aspectClass(1200, 800)).toBe('r32'); // 1.5
    expect(aspectClass(1200, 900)).toBe('r43'); // 1.33
    expect(aspectClass(1000, 1000)).toBe('r11');
    expect(aspectClass(800, 1200)).toBe('r34');
    expect(aspectClass(null, null)).toBe('r43');
    expect(aspectClass(0, 100)).toBe('r43');
  });

  test('rotationOf: ±3° 以内で、同じ番号は、いつも同じ。負の番号でも、範囲内', () => {
    for (let index = -20; index < 40; index += 1) {
      expect(Math.abs(rotationOf(index))).toBeLessThanOrEqual(3);
      expect(rotationOf(index)).toBe(rotationOf(index));
    }
    expect(rotationOf(0)).not.toBe(rotationOf(1));
  });

  test('stickerColor・formatClip', () => {
    expect(stickerColor(0)).toBe('var(--y)');
    expect(stickerColor(6)).toBe('var(--y)');
    expect(stickerColor(-1)).toBe('var(--l)');
    expect(formatClip(23)).toBe('0:23');
    expect(formatClip(125)).toBe('2:05');
  });
});
