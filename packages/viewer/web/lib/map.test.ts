import { describe, expect, test } from 'bun:test';
import {
  boundsToString,
  clusterSize,
  clusterTone,
  isPinCluster,
  isSinglePoint,
  padBounds,
  parseBounds,
} from './map';

describe('map', () => {
  test('範囲の文字: 往復できる。小数は 5 桁。読めなければ undefined', () => {
    const bounds = { south: 35.123456789, west: 139, north: 36, east: 140.5 };
    // 広がる向きに丸める(南・西は切り捨て、北・東は切り上げ)
    expect(boundsToString(bounds)).toBe('35.12345,139,36,140.5');
    expect(
      boundsToString({ south: 1, west: 2, north: 35.123451, east: 139.000001 })
    ).toBe('1,2,35.12346,139.00001');
    // 縮小して、地球の外まで映ったときは、地球の中に収める
    expect(
      boundsToString({ south: -95, west: -200, north: 95, east: 200 })
    ).toBe('-90,-180,90,180');
    expect(parseBounds('35,139,36,140')).toEqual({
      south: 35,
      west: 139,
      north: 36,
      east: 140,
    });
    expect(parseBounds('x')).toBeUndefined();
    expect(parseBounds(undefined)).toBeUndefined();
  });

  test('範囲を広げる: 地球の外には、出ない', () => {
    expect(
      padBounds({ south: 10, west: 10, north: 20, east: 30 }, 0.1)
    ).toEqual({ south: 9, west: 8, north: 21, east: 32 });
    expect(
      padBounds({ south: -89, west: -179, north: 89, east: 179 }, 1)
    ).toEqual({ south: -90, west: -180, north: 90, east: 180 });
  });

  test('印の大きさと色: 件数が多いほど大きく・濃い段へ', () => {
    expect(clusterSize(1)).toBe(38);
    expect(clusterSize(10)).toBeGreaterThan(clusterSize(2));
    expect(clusterSize(1_000_000)).toBe(96);
    expect(clusterTone(5)).toBe('g');
    expect(clusterTone(10)).toBe('b');
    expect(clusterTone(100)).toBe('y');
    expect(clusterTone(1000)).toBe('p');
  });

  test('1 点のまとまり', () => {
    expect(isSinglePoint({ minLat: 1, maxLat: 1, minLon: 2, maxLon: 2 })).toBe(
      true
    );
    expect(
      isSinglePoint({ minLat: 1, maxLat: 1.1, minLon: 2, maxLon: 2 })
    ).toBe(false);
  });

  test('まとまりを、ピンで出すか: 少ない件数、または、十分に近づいたとき', () => {
    expect(isPinCluster(4, 3)).toBe(true);
    expect(isPinCluster(5, 3)).toBe(false);
    expect(isPinCluster(500, 15.9)).toBe(false);
    expect(isPinCluster(500, 16)).toBe(true);
  });

  test('1 点のまとまりの範囲は、その写真自身を含む(端数の多い座標でも)', () => {
    const lat = 35.1234567;
    const lon = 139.7654321;
    const [south, west, north, east] = boundsToString({
      south: lat - 1e-6,
      west: lon - 1e-6,
      north: lat + 1e-6,
      east: lon + 1e-6,
    })
      .split(',')
      .map(Number) as [number, number, number, number];
    expect(south).toBeLessThanOrEqual(lat);
    expect(north).toBeGreaterThanOrEqual(lat);
    expect(west).toBeLessThanOrEqual(lon);
    expect(east).toBeGreaterThanOrEqual(lon);
  });
});
