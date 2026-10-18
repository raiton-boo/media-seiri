import { areaLabel } from '@file-seiri/core';
import {
  type AlbumFilter,
  type AlbumOrder,
  countAlbumEvents,
  countFilteredPhotos,
  getDaySummary,
  getEventDetail,
  listAlbumSections,
  listAutoAlbums,
  listCalendarDays,
  listCalendarYears,
  listDateGaps,
  listEventStacks,
  listFilteredPhotos,
  listFilterOptions,
  listLatestEvents,
  listMonthSummaries,
  listOnThisDay,
  listSectionPhotos,
  listYearCounts,
  pickPhotoOfDay,
  suggestSearch,
} from '@file-seiri/ledger';
import type { Context, Hono } from 'hono';
import type {
  AlbumEventResponse,
  AlbumFiltersResponse,
  AlbumMemoriesResponse,
  AlbumMonthResponse,
  AlbumOverviewResponse,
  AlbumSectionPhotosResponse,
  AlbumSectionsResponse,
  AlbumYearResponse,
  AreaLabelsResponse,
  AutoAlbumsResponse,
  CalendarDayResponse,
  CalendarResponse,
  SearchPhotosResponse,
  SearchSuggestResponse,
} from '../api-types.ts';
import { parseAreaRefs, suggestAreas } from './areas.ts';
import { albumFilterOf } from './filter.ts';
import { parseId } from './query.ts';
import type { ViewerSource } from './source.ts';

/** 「小さなできごと」の境(この枚数より少ないものは、まとめる。仕様書 §16-6) */
const SMALL_EVENT_FILES = 3;
/** 1 回に返す、できごとの写真の数(「もっと広げる」で、+12 枚) */
const EVENT_PAGE = 12;
const MAX_EVENT_PAGE = 60;
/** 「すべて」の、1 つの区画の写真の上限(月が、極端に多いときの、安全のため) */
const SECTION_PHOTO_LIMIT = 5000;
/** 検索の入力の、長さの上限 */
const MAX_QUERY_LENGTH = 100;
/** 検索結果で、1 回に返す写真の上限 */
const MAX_SEARCH_PAGE = 120;
/** 自動アルバムで、最初に出すできごとの数と、上限 */
const AUTO_EVENT_PAGE = 8;
const MAX_AUTO_EVENTS = 60;
/** 去年の今日に出す、できごとの数 */
const ON_THIS_DAY = 3;

const orderOf = (value: string | undefined): AlbumOrder =>
  value === 'old' ? 'old' : 'new';

/** `YYYY-MM-DD` を、年・月・日にする。読めなければ undefined */
const parseDate = (
  value: string | undefined
): { year: number; month: number; day: number } | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return undefined;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? { year, month, day }
    : undefined;
};

/**
 * アルバムの API(読み取り専用)。
 * - `GET /api/album/overview`: 年ごとの枚数
 * - `GET /api/album/year?y=`: 1 年の、月ごとの枚数と代表
 * - `GET /api/album/month?y=&m=`: 1 か月の、できごと(束)
 * - `GET /api/album/event/:id`: できごとの写真(ページ送り)と、前後のできごと
 * - `GET /api/album/all/sections`・`/api/album/all/photos?y=&m=`: 「すべて」(区画の一覧と、区画ごとの写真。絞り込みの条件つき)
 * - `GET /api/album/search/suggest?q=`・`/api/album/search/photos`: 検索の候補と結果(絞り込みの条件つき)
 * - `GET /api/album/calendar?y=`・`/api/album/day?day=`: カレンダー(日ごとの枚数・選んだ日のまとめ。絞り込みの条件つき)
 * - `GET /api/album/auto`: 自動アルバム(できごと・切り口)
 * - `GET /api/album/filters`: 絞り込みの選択肢と件数
 * - `GET /api/album/memories?date=&salt=`: 去年の今日・今日の一枚
 * どれも `order=new|old`(既定は new)で、並び順を変えられる。
 */
export const registerAlbumRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;
  // どの画面にも、同じ絞り込みの条件(URL のクエリ)が効く
  const filterOf = (context: Context) => albumFilterOf(db, context);
  // 日付の候補・地域の候補・ほか(名前・カメラ)の順。座標の候補は、地名の候補に置きかえる
  const suggestWithAreas = (text: string, filter: AlbumFilter) => {
    const base = suggestSearch(db, text, filter).filter(
      (item) => item.type !== 'place'
    );
    return [
      ...base.filter((item) => item.type === 'date'),
      ...suggestAreas(db, text, filter),
      ...base.filter((item) => item.type !== 'date'),
    ];
  };

  app.get('/api/album/overview', (context) => {
    const order = orderOf(context.req.query('order'));
    const counts = listYearCounts(db, order, filterOf(context));
    const body: AlbumOverviewResponse = {
      order,
      ...counts,
      latestYear: counts.years.reduce<number | null>(
        (latest, item) =>
          latest === null || item.year > latest ? item.year : latest,
        null
      ),
    };
    return context.json(body);
  });

  app.get('/api/album/year', (context) => {
    const year = parseId(context.req.query('y'));
    if (year === undefined || year < 1 || year > 9999) {
      return context.json({ error: 'bad year' }, 400);
    }
    const order = orderOf(context.req.query('order'));
    const months = listMonthSummaries(db, year, order, filterOf(context));
    const body: AlbumYearResponse = {
      year,
      order,
      months,
      total: months.reduce((sum, item) => sum + item.count, 0),
    };
    return context.json(body);
  });

  app.get('/api/album/month', (context) => {
    const year = parseId(context.req.query('y'));
    const month = parseId(context.req.query('m'));
    if (
      year === undefined ||
      month === undefined ||
      year < 1 ||
      year > 9999 ||
      month < 1 ||
      month > 12
    ) {
      return context.json({ error: 'bad month' }, 400);
    }
    const order = orderOf(context.req.query('order'));
    const stacks = listEventStacks(db, year, month, order, filterOf(context));
    const total =
      listMonthSummaries(db, year, 'old', filterOf(context)).find(
        (item) => item.month === month
      )?.count ?? 0;
    const body: AlbumMonthResponse = {
      year,
      month,
      order,
      total,
      events: stacks.filter((stack) => stack.fileCount >= SMALL_EVENT_FILES),
      small: stacks.filter((stack) => stack.fileCount < SMALL_EVENT_FILES),
    };
    return context.json(body);
  });

  app.get('/api/album/event/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const order = orderOf(context.req.query('order'));
    const limit = Math.min(
      Math.max(parseId(context.req.query('limit')) ?? EVENT_PAGE, 1),
      MAX_EVENT_PAGE
    );
    const offset = parseId(context.req.query('offset')) ?? 0;
    const detail =
      id === undefined
        ? undefined
        : getEventDetail(db, id, order, { limit, offset }, filterOf(context));
    if (!detail) return context.json({ error: 'not found' }, 404);
    const body: AlbumEventResponse = { ...detail, order, limit, offset };
    return context.json(body);
  });

  // 「すべて」: 区画(年月)の一覧と、区画ごとの写真。見えている区画だけ、画面が取りに来る(仮想スクロール)
  app.get('/api/album/all/sections', (context) => {
    const order = orderOf(context.req.query('order'));
    const sections = listAlbumSections(db, filterOf(context), order);
    const body: AlbumSectionsResponse = {
      order,
      total: sections.reduce((sum, section) => sum + section.count, 0),
      sections,
    };
    return context.json(body);
  });

  app.get('/api/album/all/photos', (context) => {
    const year = parseId(context.req.query('y'));
    const month = parseId(context.req.query('m'));
    if (year === undefined || month === undefined || month > 12) {
      return context.json({ error: 'bad section' }, 400);
    }
    const order = orderOf(context.req.query('order'));
    const body: AlbumSectionPhotosResponse = {
      year,
      month,
      order,
      photos: listSectionPhotos(
        db,
        filterOf(context),
        { year, month },
        order,
        SECTION_PHOTO_LIMIT
      ),
    };
    return context.json(body);
  });

  // 自動アルバム: できごと(新しい順。`limit` 件)と、いろいろな切り口
  app.get('/api/album/auto', (context) => {
    const limit = Math.min(
      Math.max(parseId(context.req.query('limit')) ?? AUTO_EVENT_PAGE, 1),
      MAX_AUTO_EVENTS
    );
    const body: AutoAlbumsResponse = {
      eventTotal: countAlbumEvents(db),
      events: listLatestEvents(db, 'new', limit),
      albums: listAutoAlbums(db),
      dateGaps: listDateGaps(db),
    };
    return context.json(body);
  });

  // カレンダー: 年の、日ごとの枚数と、選んだ日のまとめ
  app.get('/api/album/calendar', (context) => {
    const filter = filterOf(context);
    const years = listCalendarYears(db, filter);
    const requested = parseId(context.req.query('y'));
    const year =
      requested !== undefined && requested >= 1 && requested <= 9999
        ? requested
        : (years[0]?.year ?? null);
    const days = year === null ? [] : listCalendarDays(db, year, filter);
    const body: CalendarResponse = {
      years,
      year,
      days,
      total: days.reduce((sum, day) => sum + day.count, 0),
    };
    return context.json(body);
  });

  // 日付は `day`(`date` は、検索の日付の条件の名前)
  app.get('/api/album/day', (context) => {
    const date = parseDate(context.req.query('day'));
    if (!date) return context.json({ error: 'bad date' }, 400);
    const text = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    const body: CalendarDayResponse = {
      date: text,
      ...getDaySummary(db, text, filterOf(context)),
    };
    return context.json(body);
  });

  // 絞り込みの引き出し: 選択肢と件数(いまの条件のもとで、項目ごとに数える)
  app.get('/api/album/filters', (context) => {
    const body: AlbumFiltersResponse = listFilterOptions(db, filterOf(context));
    return context.json(body);
  });

  // 検索: 入力中の候補(件数つき)と、結果の写真(先頭から)
  app.get('/api/album/search/suggest', (context) => {
    // 入力は、長すぎる文字を切る(重い検索を、避ける)
    const text = (context.req.query('q') ?? '').slice(0, MAX_QUERY_LENGTH);
    const body: SearchSuggestResponse = {
      suggestions: suggestWithAreas(text, filterOf(context)),
    };
    return context.json(body);
  });

  // 札に出す、地域の名前(URL の指定から)
  app.get('/api/album/areas', (context) => {
    const labels: Record<string, string> = {};
    for (const ref of parseAreaRefs(context.req.queries('area'))) {
      const label = areaLabel(ref);
      if (label) labels[ref] = label;
    }
    const body: AreaLabelsResponse = { labels };
    return context.json(body);
  });

  app.get('/api/album/search/photos', (context) => {
    const order = orderOf(context.req.query('order'));
    const filter = filterOf(context);
    const limit = Math.min(
      Math.max(parseId(context.req.query('limit')) ?? EVENT_PAGE, 1),
      MAX_SEARCH_PAGE
    );
    const offset = parseId(context.req.query('offset')) ?? 0;
    const body: SearchPhotosResponse = {
      order,
      total: countFilteredPhotos(db, filter),
      limit,
      offset,
      photos: listFilteredPhotos(db, filter, order, { limit, offset }),
    };
    return context.json(body);
  });

  app.get('/api/album/memories', (context) => {
    const date = parseDate(context.req.query('date'));
    if (!date) return context.json({ error: 'bad date' }, 400);
    const salt = parseId(context.req.query('salt')) ?? 0;
    // 今日の一枚: 日付ごとに固定(同じ日は、同じ 1 枚)。「別の 1 枚」で、salt を増やして、選び直す
    const seed = date.year * 10_000 + date.month * 100 + date.day + salt * 7919;
    const body: AlbumMemoriesResponse = {
      onThisDay: listOnThisDay(
        db,
        date.month,
        date.day,
        date.year,
        ON_THIS_DAY
      ),
      photoOfDay: pickPhotoOfDay(db, seed),
    };
    return context.json(body);
  });
};
