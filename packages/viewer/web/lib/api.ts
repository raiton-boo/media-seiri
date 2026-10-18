import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import type {
  AlbumEventResponse,
  AlbumMemoriesResponse,
  AlbumMonthResponse,
  AlbumOverviewResponse,
  AlbumSectionPhotosResponse,
  AlbumSectionsResponse,
  AlbumYearResponse,
  DashboardResponse,
  DupeDetailResponse,
  DupesResponse,
  ErrorDetailResponse,
  ErrorsResponse,
  FallbackResponse,
  RunDetailResponse,
  RunsResponse,
  ViewerInfo,
} from '../../src/api-types.ts';

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
export const useViewerInfo = () =>
  useQuery({
    queryKey: ['info'],
    queryFn: () => fetchJson<ViewerInfo>('/api/info'),
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
  params: Record<string, string | number | undefined>
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
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

export const useAlbumOverview = (order: AlbumOrderParam) =>
  useQuery({
    queryKey: ['album-overview', order],
    queryFn: () =>
      fetchJson<AlbumOverviewResponse>(
        `/api/album/overview${queryString({ order })}`
      ),
    placeholderData: keepPreviousData,
  });

export const useAlbumYear = (
  year: number | undefined,
  order: AlbumOrderParam
) =>
  useQuery({
    queryKey: ['album-year', year, order],
    queryFn: () =>
      fetchJson<AlbumYearResponse>(
        `/api/album/year${queryString({ y: year, order })}`
      ),
    enabled: year !== undefined,
    placeholderData: keepPreviousData,
  });

export const useAlbumMonth = (
  year: number | undefined,
  month: number | undefined,
  order: AlbumOrderParam
) =>
  useQuery({
    queryKey: ['album-month', year, month, order],
    queryFn: () =>
      fetchJson<AlbumMonthResponse>(
        `/api/album/month${queryString({ y: year, m: month, order })}`
      ),
    enabled: year !== undefined && month !== undefined,
    placeholderData: keepPreviousData,
  });

/** できごとの写真は、先頭から `limit` 枚(「もっと広げる」で、増やす) */
export const useAlbumEvent = (
  id: number | undefined,
  order: AlbumOrderParam,
  limit: number
) =>
  useQuery({
    queryKey: ['album-event', id, order, limit],
    queryFn: () =>
      fetchJson<AlbumEventResponse>(
        `/api/album/event/${id}${queryString({ order, limit })}`
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

export const useAlbumSections = (order: AlbumOrderParam) =>
  useQuery({
    queryKey: ['album-all-sections', order],
    queryFn: () =>
      fetchJson<AlbumSectionsResponse>(
        `/api/album/all/sections${queryString({ order })}`
      ),
    placeholderData: keepPreviousData,
  });

/** 「すべて」の 1 区画(年・月)の写真。画面に近づいたときだけ、読む */
export const useSectionPhotos = (
  year: number,
  month: number,
  order: AlbumOrderParam,
  enabled: boolean
) =>
  useQuery({
    queryKey: ['album-all-photos', year, month, order],
    queryFn: () =>
      fetchJson<AlbumSectionPhotosResponse>(
        `/api/album/all/photos${queryString({ y: year, m: month, order })}`
      ),
    enabled,
    staleTime: 60_000,
  });
