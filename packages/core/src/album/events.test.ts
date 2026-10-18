import { describe, expect, test } from 'bun:test';
import {
  computeAlbumEvents,
  DEFAULT_EVENT_OPTIONS,
  distanceKm,
  type EventFile,
} from './events.ts';

const full = (
  id: number,
  takenAt: string,
  gps?: [number, number]
): EventFile => ({
  id,
  takenAt,
  precision: 'full',
  ...(gps ? { lat: gps[0], lon: gps[1] } : {}),
});
const day = (id: number, takenAt: string): EventFile => ({
  id,
  takenAt,
  precision: 'date',
});
const ids = (events: ReturnType<typeof computeAlbumEvents>) =>
  events.map((e) => e.fileIds);

describe('computeAlbumEvents: 時間の区切り', () => {
  test('4 時間未満なら、同じできごと。ちょうど 4 時間(以上)なら、新しいできごと', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00'),
          full(2, '2024-03-05T13:59:59'),
        ])
      )
    ).toEqual([[1, 2]]);
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00'),
          full(2, '2024-03-05T14:00:00'),
        ])
      )
    ).toEqual([[1], [2]]);
  });

  test('隣り合う 2 枚の間を見る(全体の長さは、見ない)。1 時間おきなら、何枚でも、続く', () => {
    const files = Array.from({ length: 10 }, (_, i) =>
      full(i + 1, `2024-03-05T${String(8 + i).padStart(2, '0')}:00:00`)
    );
    expect(ids(computeAlbumEvents(files))).toEqual([files.map((f) => f.id)]);
  });

  test('入力の並びに、よらない(撮影日時の順に、並べ直す)。同じ時刻は、ID の順', () => {
    const events = computeAlbumEvents([
      full(3, '2024-03-05T10:30:00'),
      full(1, '2024-03-05T10:00:00'),
      full(2, '2024-03-05T10:00:00'),
    ]);
    expect(ids(events)).toEqual([[1, 2, 3]]);
    expect(events[0]).toMatchObject({
      startAt: '2024-03-05T10:00:00',
      endAt: '2024-03-05T10:30:00',
    });
  });

  test('日をまたいでも、4 時間未満なら、同じできごと', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T23:00:00'),
          full(2, '2024-03-06T01:00:00'),
        ])
      )
    ).toEqual([[1, 2]]);
  });
});

describe('computeAlbumEvents: 距離の区切り(GPS がある場合のみ)', () => {
  const tokyo: [number, number] = [35.68, 139.76];
  const yokohama: [number, number] = [35.44, 139.64]; // 約 29 km
  const nearTokyo: [number, number] = [35.69, 139.77]; // 約 1.4 km

  test('5km 以上で、1 時間以上あいたら、新しいできごと', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00', tokyo),
          full(2, '2024-03-05T11:00:00', yokohama),
        ])
      )
    ).toEqual([[1], [2]]);
  });

  test('5km 以上でも、1 時間未満なら、同じできごと(移動中の撮影)', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00', tokyo),
          full(2, '2024-03-05T10:59:59', yokohama),
        ])
      )
    ).toEqual([[1, 2]]);
  });

  test('5km 未満なら、1 時間以上あいても、同じできごと', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00', tokyo),
          full(2, '2024-03-05T12:00:00', nearTokyo),
        ])
      )
    ).toEqual([[1, 2]]);
  });

  test('片方に GPS がなければ、距離は、見ない', () => {
    expect(
      ids(
        computeAlbumEvents([
          full(1, '2024-03-05T10:00:00', tokyo),
          full(2, '2024-03-05T12:00:00'),
        ])
      )
    ).toEqual([[1, 2]]);
  });

  test('規則は、変えられる(例: 1 時間以上で区切る)', () => {
    const options = { ...DEFAULT_EVENT_OPTIONS, gapHours: 1 };
    expect(
      ids(
        computeAlbumEvents(
          [full(1, '2024-03-05T10:00:00'), full(2, '2024-03-05T11:00:00')],
          options
        )
      )
    ).toEqual([[1], [2]]);
    expect(
      computeAlbumEvents([full(1, '2024-03-05T10:00:00')], options)[0]?.rule
    ).toBe('1h/5km');
  });

  test('distanceKm: 東京 → 横浜は、約 29 km', () => {
    expect(
      distanceKm({ lat: 35.68, lon: 139.76 }, { lat: 35.44, lon: 139.64 })
    ).toBeCloseTo(29, 0);
    expect(distanceKm({ lat: 1, lon: 1 }, { lat: 1, lon: 1 })).toBe(0);
  });
});

describe('computeAlbumEvents: 精度・代表・位置', () => {
  test('精度 date(時刻なし)は、日単位で、1 つのできごと。full とは、別のできごと', () => {
    const events = computeAlbumEvents([
      day(1, '2024-03-05'),
      day(2, '2024-03-05'),
      day(3, '2024-03-06'),
      full(4, '2024-03-05T10:00:00'),
    ]);
    expect(ids(events)).toEqual([[1, 2], [4], [3]]);
    expect(events[0]).toMatchObject({
      startAt: '2024-03-05',
      endAt: '2024-03-05',
      rule: 'day',
    });
  });

  test('代表の写真は、GPS つきを優先する。なければ、先頭。位置は、GPS つきの平均', () => {
    const events = computeAlbumEvents([
      full(1, '2024-03-05T10:00:00'),
      full(2, '2024-03-05T10:10:00', [35, 139]),
      full(3, '2024-03-05T10:20:00', [37, 141]),
    ]);
    expect(events[0]?.coverId).toBe(2);
    expect(events[0]?.centroid).toEqual({ lat: 36, lon: 140 });
    const noGps = computeAlbumEvents([
      full(5, '2024-03-05T10:00:00'),
      full(6, '2024-03-05T10:10:00'),
    ]);
    expect(noGps[0]).toMatchObject({ coverId: 5, centroid: null });
  });

  test('空なら、できごとも、なし。形式が正しくない日時は、エラー', () => {
    expect(computeAlbumEvents([])).toEqual([]);
    expect(() => computeAlbumEvents([full(1, '2024/03/05')])).toThrow(
      RangeError
    );
  });
});
