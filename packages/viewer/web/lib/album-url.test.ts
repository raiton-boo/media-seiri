import { describe, expect, test } from 'bun:test';
import { albumHref, calendarHref } from './album-url.ts';

describe('albumHref', () => {
  test('入口は、クエリなし。新しい順(既定)は、出さない', () => {
    expect(albumHref()).toBe('/album');
    expect(albumHref({ order: 'new' })).toBe('/album');
  });

  test('年・月・できごと・並び順・小さなできごと・広げた数を、クエリにする', () => {
    expect(albumHref({ view: 'year', y: 2014, order: 'old' })).toBe(
      '/album?view=year&y=2014&order=old'
    );
    expect(albumHref({ view: 'month', y: 2014, m: 4, small: true })).toBe(
      '/album?view=month&y=2014&m=4&small=1'
    );
    expect(albumHref({ view: 'event', e: 12, more: 24 })).toBe(
      '/album?view=event&e=12&more=24'
    );
  });
});

describe('calendarHref', () => {
  test('カレンダーは、/calendar のページ。年・選んだ日・条件を、クエリにする', () => {
    expect(calendarHref()).toBe('/calendar');
    expect(calendarHref({ y: 2016, d: '2016-08-13' })).toBe(
      '/calendar?y=2016&d=2016-08-13'
    );
    expect(
      calendarHref({
        y: 2016,
        filter: {
          kinds: ['video'],
          cameras: [],
          years: [],
          precisions: [],
          sources: [],
          volumes: [],
          dates: [],
          names: [],
          places: [],
          areas: [],
        },
        drawer: true,
      })
    ).toBe('/calendar?y=2016&kind=video&drawer=1');
  });
});
