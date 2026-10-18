import {
  type AlbumFilter,
  parseDateQuery,
  roundToPlaceCell,
} from '@file-seiri/ledger';

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

/** `南,西,北,東`(度)を、範囲にする。数でない・範囲外・向きが逆なら、undefined */
export const parseBbox = (
  value: string | undefined
): { south: number; west: number; north: number; east: number } | undefined => {
  const parts = (value ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)))
    return undefined;
  const [south, west, north, east] = parts as [number, number, number, number];
  const valid =
    south >= -90 &&
    north <= 90 &&
    west >= -180 &&
    east <= 180 &&
    south <= north &&
    west <= east;
  return valid ? { south, west, north, east } : undefined;
};

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
  // 検索の条件: 日付は、書き方をそろえる(読めないものは、無視)。名前は、カンマを含みうるので、そのまま。場所は、`緯度:経度`
  const dates = [
    ...new Set(
      list('date')
        .map((value) => parseDateQuery(value))
        .filter((value): value is string => value !== undefined)
    ),
  ];
  const eventId = parseId(list('event')[0]);
  const livePhotos = list('live')[0] === '1';
  // 範囲は、カンマ区切りの 4 つの数なので、カンマで割らず、そのまま渡す
  const bbox = parseBbox(queries('bbox')?.[0]);
  const names = (queries('name') ?? []).filter(Boolean);
  const places = list('place').flatMap((value) => {
    const [lat, lon] = value.split(':').map(Number);
    return lat !== undefined &&
      lon !== undefined &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
      ? [{ lat: roundToPlaceCell(lat), lon: roundToPlaceCell(lon) }]
      : [];
  });
  return {
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(cameras.length > 0 ? { cameras } : {}),
    ...(gps === '1' ? { gps: true } : gps === '0' ? { gps: false } : {}),
    ...(years.length > 0 ? { years } : {}),
    ...(precisions.length > 0 ? { precisions } : {}),
    ...(dateSources.length > 0 ? { dateSources } : {}),
    ...(volumeIds.length > 0 ? { volumeIds } : {}),
    ...(livePhotos ? { livePhotos } : {}),
    ...(bbox ? { bbox } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
    ...(dates.length > 0 ? { dates } : {}),
    ...(names.length > 0 ? { names } : {}),
    ...(places.length > 0 ? { places } : {}),
  };
};
