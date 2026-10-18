import {
  type AlbumOrder,
  getEventDetail,
  listAlbumSections,
  listEventStacks,
  listFilterOptions,
  listMonthSummaries,
  listOnThisDay,
  listSectionPhotos,
  listYearCounts,
  pickPhotoOfDay,
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
} from '../api-types.ts';
import { parseAlbumFilter, parseId } from './query.ts';
import type { ViewerSource } from './source.ts';

/** 「小さなできごと」の境(この枚数より少ないものは、まとめる。仕様書 §16-6) */
const SMALL_EVENT_FILES = 3;
/** 1 回に返す、できごとの写真の数(「もっと広げる」で、+12 枚) */
const EVENT_PAGE = 12;
const MAX_EVENT_PAGE = 60;
/** 「すべて」の、1 つの区画の写真の上限(月が、極端に多いときの、安全のため) */
const SECTION_PHOTO_LIMIT = 5000;
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
 * - `GET /api/album/filters`: 絞り込みの選択肢と件数
 * - `GET /api/album/memories?date=&salt=`: 去年の今日・今日の一枚
 * どれも `order=new|old`(既定は new)で、並び順を変えられる。
 */
export const registerAlbumRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;
  // どの画面にも、同じ絞り込みの条件(URL のクエリ)が効く
  const filterOf = (context: Context) =>
    parseAlbumFilter((name) => context.req.queries(name));

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

  // 絞り込みの引き出し: 選択肢と件数(いまの条件のもとで、項目ごとに数える)
  app.get('/api/album/filters', (context) => {
    const body: AlbumFiltersResponse = listFilterOptions(db, filterOf(context));
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
