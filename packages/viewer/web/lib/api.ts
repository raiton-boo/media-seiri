import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import type { DashboardResponse, ViewerInfo } from '../../src/api-types.ts';

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
