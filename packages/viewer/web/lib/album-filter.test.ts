import { describe, expect, test } from 'bun:test';
import {
  countFilter,
  EMPTY_FILTER,
  filterParams,
  readFilter,
  toggleValue,
} from './album-filter';

describe('album-filter', () => {
  test('URL から読む。gps は、1 と 0 だけ', () => {
    const query: Record<string, string[]> = {
      kind: ['photo', 'video'],
      gps: ['1'],
      camera: ['Canon IXY, Digital'],
    };
    const filter = readFilter((key) => query[key] ?? []);
    expect(filter).toMatchObject({
      kinds: ['photo', 'video'],
      gps: '1',
      cameras: ['Canon IXY, Digital'],
      years: [],
    });
    expect(readFilter(() => ['x']).gps).toBeUndefined();
  });

  test('項目で数える(複数の値は、1 件)', () => {
    expect(countFilter(EMPTY_FILTER)).toBe(0);
    expect(
      countFilter({ ...EMPTY_FILTER, kinds: ['photo', 'raw'], gps: '0' })
    ).toBe(2);
  });

  test('クエリの項目にする', () => {
    expect(filterParams({ ...EMPTY_FILTER, years: ['2014'] })).toMatchObject({
      year: ['2014'],
      kind: [],
      gps: undefined,
    });
  });

  test('値の出し入れ', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});
