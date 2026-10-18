import type { Database } from 'bun:sqlite';
import {
  type AreaRef,
  areaLabel,
  areaRefsOf,
  nearestCity,
  searchAreas,
} from '@file-seiri/core';
import {
  type AlbumFilter,
  countFilteredPhotos,
  listGpsCells,
  NO_PLACE,
} from '@file-seiri/ledger';
import type { AreaSuggestion } from '../api-types.ts';

/** 地域の指定の形(`city:<ID>`・`pref:<2 桁>`・`country:<国コード>`)。これ以外は、無視する */
const AREA_REF = /^(city:\d+|pref:\d{2}|country:[A-Z]{2})$/;

/** クエリの `area` を、正しい指定だけにする(重複は、まとめる) */
export const parseAreaRefs = (values: string[] | undefined): AreaRef[] => [
  ...new Set((values ?? []).filter((value) => AREA_REF.test(value))),
];

type Cell = { lat: number; lon: number; count: number };

/** 場所の格子ごとに、含まれる地域の指定(地名・都道府県・国)を付ける。近い地名がない格子は、地域なし */
const cellsWithAreas = (cells: Cell[]): { cell: Cell; refs: AreaRef[] }[] =>
  cells.map((cell) => {
    const city = nearestCity(cell.lat, cell.lon);
    return { cell, refs: city ? areaRefsOf(city) : [] };
  });

/**
 * 地域に入る写真の、場所の格子(絞り込みの `places` に足す)。
 * 台帳の全部の格子を、近い地名で分類する(格子は、写真があるところだけなので、少ない)。
 * 1 つも入らなければ、どの写真にも合わない印(`NO_PLACE`)を、返す。
 */
export const cellsOfAreas = (
  db: Database,
  refs: AreaRef[]
): { lat: number; lon: number }[] => {
  const wanted = new Set(refs);
  const cells = cellsWithAreas(listGpsCells(db, {}))
    .filter((item) => item.refs.some((ref) => wanted.has(ref)))
    .map((item) => ({ lat: item.cell.lat, lon: item.cell.lon }));
  return cells.length > 0 ? cells : [NO_PLACE];
};

/** 絞り込みの条件に、地域の指定を、場所の格子として足す */
export const withAreas = (
  db: Database,
  filter: AlbumFilter,
  refs: AreaRef[]
): AlbumFilter =>
  refs.length === 0
    ? filter
    : {
        ...filter,
        places: [...(filter.places ?? []), ...cellsOfAreas(db, refs)],
      };

const CITY_LIMIT = 3;
const OTHER_LIMIT = 1;

/** よく撮った地域(入力が空のとき): 枚数の多い地名と、都道府県・国 */
const topAreas = (db: Database, filter: AlbumFilter): AreaSuggestion[] => {
  const totals = new Map<AreaRef, number>();
  for (const { cell, refs } of cellsWithAreas(listGpsCells(db, filter))) {
    for (const ref of refs)
      totals.set(ref, (totals.get(ref) ?? 0) + cell.count);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const pick = (prefix: string, limit: number) =>
    ranked.filter(([ref]) => ref.startsWith(prefix)).slice(0, limit);
  return [
    ...pick('city:', CITY_LIMIT),
    ...pick('pref:', OTHER_LIMIT),
    ...pick('country:', OTHER_LIMIT),
  ].flatMap(([ref, count]) => {
    const label = areaLabel(ref);
    return label ? [{ type: 'area' as const, value: ref, label, count }] : [];
  });
};

const PLACE_WORDS = /場所|gps|位置|place/i;

/**
 * 地域(地名・都道府県・国)の候補。件数は、いまの条件に、その地域を足した結果の枚数(0 のものは、出さない)。
 * 入力が空(または「場所」「GPS」など)なら、よく撮った地域。
 */
export const suggestAreas = (
  db: Database,
  text: string,
  filter: AlbumFilter
): AreaSuggestion[] => {
  const query = text.trim();
  if (query === '' || PLACE_WORDS.test(query)) return topAreas(db, filter);
  return searchAreas(query, 8).flatMap((ref) => {
    const label = areaLabel(ref);
    if (!label) return [];
    const count = countFilteredPhotos(db, withAreas(db, filter, [ref]));
    return count > 0
      ? [{ type: 'area' as const, value: ref, label, count }]
      : [];
  });
};
