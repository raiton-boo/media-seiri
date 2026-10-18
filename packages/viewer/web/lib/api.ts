import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
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
  DashboardResponse,
  DupeDetailResponse,
  DupesResponse,
  ErrorDetailResponse,
  ErrorsResponse,
  FallbackResponse,
  MapClustersResponse,
  MapConfigResponse,
  PhotoDetailResponse,
  PhotoStripResponse,
  RunDetailResponse,
  RunsResponse,
  SearchPhotosResponse,
  SearchSuggestResponse,
  SlideshowResponse,
  ViewerInfo,
} from '../../src/api-types.ts';
import { type FilterState, filterParams } from './album-filter';

/** API の場所。同じ場所から配信するので、空(相対パス)。開発で、別のポートの API を使うときだけ、指定する */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`API が失敗しました(${path}): ${response.status}`);
  }
  return (await response.json()) as T;
};

/** 上のナビのチップが使う。読み込み中でも、画面を止めない */
/** ドライブが外れているとき、接続を確かめ直す間隔(ミリ秒) */
const DRIVE_RECHECK_MS = 10_000;

export const useViewerInfo = () =>
  useQuery({
    queryKey: ['info'],
    queryFn: () => fetchJson<ViewerInfo>('/api/info'),
    // ドライブが外れている間は、接続されたかを、ときどき確かめる(「再確認」を押さなくても、帯が消える)
    refetchInterval: (query) =>
      query.state.data?.libraryConnected === false ? DRIVE_RECHECK_MS : false,
  });

/** 実行中の取り込みがあれば、この間隔(ミリ秒)で、読み直す */
const RUNNING_REFRESH_MS = 2000;

/** ダッシュボード。読み込み中は、Suspense のスケルトンを出す */
export const useDashboard = () =>
  useSuspenseQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchJson<DashboardResponse>('/api/dashboard'),
    refetchInterval: (query) =>
      query.state.data?.running ? RUNNING_REFRESH_MS : false,
  });

/** サムネイルの URL。`thumbRelPath`(`thumbs/` からの相対パス)から作る */
export const thumbUrl = (thumbRelPath: string): string =>
  `${API_BASE}/api/thumbs/${thumbRelPath}`;

/** クエリ文字列を作る(空の値は、入れない) */
export const queryString = (
  params: Record<string, string | number | string[] | undefined>
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // 配列は、同じ名前を繰り返す
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== '') search.append(key, String(item));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

/** CSV の書き出し先(API の URL。絞り込みを、そのまま渡す) */
export const errorsCsvUrl = (params: { code?: string; run?: string }): string =>
  `${API_BASE}/api/errors.csv${queryString(params)}`;

/** 一覧: 絞り込みを変えても、前の結果を出したまま読み直す(画面が、ちらつかないように) */
export const useErrors = (params: {
  code?: string;
  run?: string;
  offset: number;
}) =>
  useQuery({
    queryKey: ['errors', params],
    queryFn: () =>
      fetchJson<ErrorsResponse>(`/api/errors${queryString(params)}`),
    placeholderData: keepPreviousData,
  });

export const useErrorDetail = (id: number | undefined) =>
  useQuery({
    queryKey: ['error', id],
    queryFn: () => fetchJson<ErrorDetailResponse>(`/api/errors/${id}`),
    enabled: id !== undefined,
  });

export const useRuns = (params: { filter?: string; offset: number }) =>
  useQuery({
    queryKey: ['runs', params],
    queryFn: () => fetchJson<RunsResponse>(`/api/runs${queryString(params)}`),
    placeholderData: keepPreviousData,
  });

export const useRunDetail = (id: number | undefined) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => fetchJson<RunDetailResponse>(`/api/runs/${id}`),
    enabled: id !== undefined,
  });

export const useFallback = (params: {
  source?: string;
  precision?: string;
  volume?: string;
  run?: string;
  offset: number;
}) =>
  useQuery({
    queryKey: ['fallback', params],
    queryFn: () =>
      fetchJson<FallbackResponse>(`/api/fallback${queryString(params)}`),
    placeholderData: keepPreviousData,
  });

export const useDupes = (params: {
  volume?: string;
  run?: string;
  q?: string;
  offset: number;
}) =>
  useQuery({
    queryKey: ['dupes', params],
    queryFn: () => fetchJson<DupesResponse>(`/api/dupes${queryString(params)}`),
    placeholderData: keepPreviousData,
  });

export const useDupeDetail = (id: number | undefined) =>
  useQuery({
    queryKey: ['dupe', id],
    queryFn: () => fetchJson<DupeDetailResponse>(`/api/dupes/${id}`),
    enabled: id !== undefined,
  });

/** アルバムの並び順(`new` は、URL では省く) */
export type AlbumOrderParam = 'new' | 'old';

export const useAlbumOverview = (order: AlbumOrderParam, filter: FilterState) =>
  useQuery({
    queryKey: ['album-overview', order, filter],
    queryFn: () =>
      fetchJson<AlbumOverviewResponse>(
        `/api/album/overview${queryString({ order, ...filterParams(filter) })}`
      ),
    placeholderData: keepPreviousData,
  });

export const useAlbumYear = (
  year: number | undefined,
  order: AlbumOrderParam,
  filter: FilterState
) =>
  useQuery({
    queryKey: ['album-year', year, order, filter],
    queryFn: () =>
      fetchJson<AlbumYearResponse>(
        `/api/album/year${queryString({ y: year, order, ...filterParams(filter) })}`
      ),
    enabled: year !== undefined,
    placeholderData: keepPreviousData,
  });

export const useAlbumMonth = (
  year: number | undefined,
  month: number | undefined,
  order: AlbumOrderParam,
  filter: FilterState
) =>
  useQuery({
    queryKey: ['album-month', year, month, order, filter],
    queryFn: () =>
      fetchJson<AlbumMonthResponse>(
        `/api/album/month${queryString({ y: year, m: month, order, ...filterParams(filter) })}`
      ),
    enabled: year !== undefined && month !== undefined,
    placeholderData: keepPreviousData,
  });

/** できごとの写真は、先頭から `limit` 枚(「もっと広げる」で、増やす) */
export const useAlbumEvent = (
  id: number | undefined,
  order: AlbumOrderParam,
  limit: number,
  filter: FilterState
) =>
  useQuery({
    queryKey: ['album-event', id, order, limit, filter],
    queryFn: () =>
      fetchJson<AlbumEventResponse>(
        `/api/album/event/${id}${queryString({ order, limit, ...filterParams(filter) })}`
      ),
    enabled: id !== undefined,
    placeholderData: keepPreviousData,
  });

export const useAlbumMemories = (date: string, salt: number) =>
  useQuery({
    queryKey: ['album-memories', date, salt],
    queryFn: () =>
      fetchJson<AlbumMemoriesResponse>(
        `/api/album/memories${queryString({ date, salt: salt || undefined })}`
      ),
    placeholderData: keepPreviousData,
  });

export const useAlbumSections = (order: AlbumOrderParam, filter: FilterState) =>
  useQuery({
    queryKey: ['album-all-sections', order, filter],
    queryFn: () =>
      fetchJson<AlbumSectionsResponse>(
        `/api/album/all/sections${queryString({ order, ...filterParams(filter) })}`
      ),
    placeholderData: keepPreviousData,
  });

/** 「すべて」の 1 区画(年・月)の写真。画面に近づいたときだけ、読む */
export const useSectionPhotos = (
  year: number,
  month: number,
  order: AlbumOrderParam,
  filter: FilterState,
  enabled: boolean
) =>
  useQuery({
    queryKey: ['album-all-photos', year, month, order, filter],
    queryFn: () =>
      fetchJson<AlbumSectionPhotosResponse>(
        `/api/album/all/photos${queryString({ y: year, m: month, order, ...filterParams(filter) })}`
      ),
    enabled,
    staleTime: 60_000,
  });

/** 絞り込みの引き出し: 選択肢と件数(いまの条件のもとで、項目ごとに数える)。引き出しを開いているときだけ読む */
export const useAlbumFilters = (filter: FilterState, enabled: boolean) =>
  useQuery({
    queryKey: ['album-filters', filter],
    queryFn: () =>
      fetchJson<AlbumFiltersResponse>(
        `/api/album/filters${queryString(filterParams(filter))}`
      ),
    enabled,
    placeholderData: keepPreviousData,
  });

/** 検索の候補。入力が止まってから(呼ぶ側で間を置く)、開いているときだけ読む */
export const useSearchSuggest = (
  text: string,
  filter: FilterState,
  enabled: boolean
) =>
  useQuery({
    queryKey: ['album-search-suggest', text, filter],
    queryFn: () =>
      fetchJson<SearchSuggestResponse>(
        `/api/album/search/suggest${queryString({ q: text, ...filterParams(filter) })}`
      ),
    enabled,
    placeholderData: keepPreviousData,
  });

/** 検索の結果: 合う枚数と、先頭から `limit` 枚 */
export const useSearchPhotos = (
  order: AlbumOrderParam,
  filter: FilterState,
  limit: number,
  enabled: boolean
) =>
  useQuery({
    queryKey: ['album-search-photos', order, filter, limit],
    queryFn: () =>
      fetchJson<SearchPhotosResponse>(
        `/api/album/search/photos${queryString({ order, limit, ...filterParams(filter) })}`
      ),
    enabled,
    placeholderData: keepPreviousData,
  });

/** 原本(拡大表示)。ライブラリが接続中で、ブラウザで表示できる形のときだけ、取れる */
export const originalUrl = (libraryFileId: number): string =>
  `${API_BASE}/api/files/${libraryFileId}`;

export const usePhotoDetail = (id: number | undefined) =>
  useQuery({
    queryKey: ['album-photo', id],
    queryFn: () => fetchJson<PhotoDetailResponse>(`/api/album/photo/${id}`),
    enabled: id !== undefined,
    placeholderData: keepPreviousData,
  });

/** 前後の写真。できごとの中だけで動くときは、`eventId` */
export const usePhotoStrip = (
  id: number | undefined,
  order: AlbumOrderParam,
  filter: FilterState,
  eventId: number | undefined
) =>
  useQuery({
    queryKey: ['album-photo-strip', id, order, filter, eventId],
    queryFn: () =>
      fetchJson<PhotoStripResponse>(
        `/api/album/photo/${id}/strip${queryString({ order, event: eventId, ...filterParams(filter) })}`
      ),
    enabled: id !== undefined,
    placeholderData: keepPreviousData,
  });

/** 地域の札の名前(URL の指定から)。指定がなければ、読まない */
export const useAreaLabels = (areas: string[]) =>
  useQuery({
    queryKey: ['album-area-labels', areas],
    queryFn: () =>
      fetchJson<AreaLabelsResponse>(
        `/api/album/areas${queryString({ area: areas })}`
      ),
    enabled: areas.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  });

/** スライドショーの写真(表示の順。先頭から一定の枚数まで) */
export const useSlideshow = (
  order: AlbumOrderParam,
  filter: FilterState,
  eventId: number | undefined
) =>
  useQuery({
    queryKey: ['album-slideshow', order, filter, eventId],
    queryFn: () =>
      fetchJson<SlideshowResponse>(
        `/api/album/slideshow${queryString({ order, event: eventId, ...filterParams(filter) })}`
      ),
    placeholderData: keepPreviousData,
  });

/** カレンダー: 選べる年と、1 年の日ごとの枚数。年を省くと、いちばん新しい年 */
export const useCalendar = (year: number | undefined, filter: FilterState) =>
  useQuery({
    queryKey: ['album-calendar', year, filter],
    queryFn: () =>
      fetchJson<CalendarResponse>(
        `/api/album/calendar${queryString({ y: year, ...filterParams(filter) })}`
      ),
    placeholderData: keepPreviousData,
  });

/** 選んだ日のまとめ(枚数・最初と最後の時刻・GPS) */
export const useCalendarDay = (date: string | undefined, filter: FilterState) =>
  useQuery({
    queryKey: ['album-calendar-day', date, filter],
    queryFn: () =>
      fetchJson<CalendarDayResponse>(
        `/api/album/day${queryString({ day: date, ...filterParams(filter) })}`
      ),
    enabled: date !== undefined,
    placeholderData: keepPreviousData,
  });

/** 自動アルバム: できごと(新しい順。先頭から `limit` 件)と、いろいろな切り口 */
export const useAutoAlbums = (limit: number) =>
  useQuery({
    queryKey: ['album-auto', limit],
    queryFn: () =>
      fetchJson<AutoAlbumsResponse>(`/api/album/auto${queryString({ limit })}`),
    placeholderData: keepPreviousData,
  });

/** 背景地図の設定(提供元・出典)。変わらないので、1 回だけ読む */
export const useMapConfig = () =>
  useQuery({
    queryKey: ['map-config'],
    queryFn: () => fetchJson<MapConfigResponse>('/api/map/config'),
    staleTime: Number.POSITIVE_INFINITY,
  });

/** 表示範囲(`南,西,北,東`)・ズームでの、地図のまとまり(クラスタ)。条件が効く */
export const useMapClusters = (
  view: string | undefined,
  zoom: number,
  filter: FilterState
) =>
  useQuery({
    queryKey: ['map-clusters', view, Math.round(zoom * 10), filter],
    queryFn: () =>
      fetchJson<MapClustersResponse>(
        `/api/map/clusters${queryString({ view, zoom: zoom.toFixed(1), ...filterParams(filter) })}`
      ),
    enabled: view !== undefined,
    placeholderData: keepPreviousData,
  });
