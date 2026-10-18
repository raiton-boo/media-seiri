import { describe, expect, test } from 'bun:test';
import {
  countFilter,
  countSearch,
  EMPTY_FILTER,
  type FilterState,
  filterParams,
  isFiltered,
  readFilter,
  removeLastCondition,
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

  test('検索の条件は、絞り込みの数に入れず、1 つずつ数える', () => {
    const filter = {
      ...EMPTY_FILTER,
      dates: ['2014-04'],
      names: ['a', 'b'],
      areas: ['city:1'],
    };
    expect(countFilter(filter)).toBe(0);
    expect(countSearch(filter)).toBe(4);
    expect(isFiltered(filter)).toBe(true);
    expect(isFiltered(EMPTY_FILTER)).toBe(false);
  });

  test('値の出し入れ', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });

  test('条件を 1 つずつ外す: 検索の条件(後ろ)から。複数の値は、後ろの値から', () => {
    let filter: FilterState = {
      ...EMPTY_FILTER,
      kinds: ['photo'],
      gps: '1' as const,
      dates: ['2014-04'],
      areas: ['city:1', 'pref:40'],
    };
    filter = removeLastCondition(filter);
    expect(filter.areas).toEqual(['city:1']);
    filter = removeLastCondition(filter);
    expect(filter.areas).toEqual([]);
    filter = removeLastCondition(filter);
    expect(filter.dates).toEqual([]);
    filter = removeLastCondition(filter);
    expect(filter.gps).toBeUndefined();
    filter = removeLastCondition(filter);
    expect(filter.kinds).toEqual([]);
    expect(isFiltered(filter)).toBe(false);
    // 条件がなければ、そのまま
    expect(removeLastCondition(filter)).toEqual(filter);
  });
});
