import type { AlbumFilter } from '@file-seiri/ledger';

/** クエリ文字列の読み取り。不正な値は、既定値にする(エラーにはしない。画面の URL を手で書き換えても、壊れないように) */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
};

export const parsePage = (query: {
  limit?: string;
  offset?: string;
}): { limit: number; offset: number } => {
  const limit = toInt(query.limit);
  return {
    limit:
      limit === undefined || limit < 1
        ? DEFAULT_LIMIT
        : Math.min(limit, MAX_LIMIT),
    offset: toInt(query.offset) ?? 0,
  };
};

export const parseId = (value: string | undefined): number | undefined =>
  toInt(value);

const KINDS = ['photo', 'video', 'raw'] as const;
const DATE_SOURCES = ['exif', 'video', 'json', 'filename', 'none'] as const;
const PRECISIONS = [
  'full',
  'date',
  'month',
  'year',
  'none',
  'invalid',
] as const;

const oneOf = <T extends string>(
  values: readonly string[],
  allowed: readonly T[]
): T[] =>
  values.filter((value): value is T =>
    (allowed as readonly string[]).includes(value)
  );

/**
 * アルバムの絞り込みの条件を、クエリから読む(`kind`・`camera`・`gps`・`year`・`precision`・`source`・`volume`)。
 * 同じ名前を、くり返して、複数の値を渡せる(`kind=photo&kind=video`)。知らない値・不正な値は、無視する。
 */
export const parseAlbumFilter = (
  queries: (name: string) => string[] | undefined
): AlbumFilter => {
  const list = (name: string): string[] =>
    (queries(name) ?? []).flatMap((value) => value.split(',')).filter(Boolean);
  const numbers = (name: string): number[] =>
    list(name)
      .map((value) => parseId(value))
      .filter((value): value is number => value !== undefined);
  const kinds = oneOf(list('kind'), KINDS);
  const precisions = oneOf(list('precision'), PRECISIONS);
  const dateSources = oneOf(list('source'), DATE_SOURCES);
  const years = numbers('year');
  const volumeIds = numbers('volume');
  // 機種名は、カンマを含みうるので、カンマで割らず、そのまま
  const cameras = (queries('camera') ?? []).filter(Boolean);
  const gps = list('gps')[0];
  return {
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(cameras.length > 0 ? { cameras } : {}),
    ...(gps === '1' ? { gps: true } : gps === '0' ? { gps: false } : {}),
    ...(years.length > 0 ? { years } : {}),
    ...(precisions.length > 0 ? { precisions } : {}),
    ...(dateSources.length > 0 ? { dateSources } : {}),
    ...(volumeIds.length > 0 ? { volumeIds } : {}),
  };
};
