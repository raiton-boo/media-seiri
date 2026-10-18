'use client';

import type { EventRecord, RunningProgress } from '@file-seiri/ledger';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  DashboardResponse,
  LiveLogMessage,
  LiveProgressMessage,
} from '../../src/api-types';
import { API_BASE, useViewerInfo } from './api';
import { setLiveConnected } from './live-status';

/** 手元に持つ、ログの最大の数 */
const MAX_LOGS = 50;
/** 実行の詳細を、読み直す間隔(ミリ秒)。進み具合が、変わるたびには、読まない */
const DETAIL_REFRESH_MS = 2000;

export type LiveState = {
  /** リアルタイム配信につながっているか */
  connected: boolean;
  /** 実行中の取り込み。まだ分からない(受け取っていない)ときは undefined */
  running: RunningProgress | null | undefined;
  /** 新しいログ(古い順。INFO 以上) */
  logs: EventRecord[];
};

const LiveContext = createContext<LiveState>({
  connected: false,
  running: undefined,
  logs: [],
});

export const useLive = (): LiveState => useContext(LiveContext);

/**
 * 実行状況のリアルタイム配信(SSE)を、受ける。この Mac の作業用の台帳のときだけ、つなぐ。
 * 進み具合は、ダッシュボードのキャッシュへ流し込み、実行が始まった・終わったときは、一覧・集計を読み直す。
 * ブラウザが、切れたときは、自動で、つなぎ直す。
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const info = useViewerInfo();
  const enabled = info.data?.source === 'working';
  const [state, setState] = useState<LiveState>({
    connected: false,
    running: undefined,
    logs: [],
  });

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${API_BASE}/api/live`);
    let previous: RunningProgress | null | undefined;
    let lastDetail = 0;

    source.addEventListener('open', () => {
      setLiveConnected(true);
      setState((current) => ({ ...current, connected: true }));
    });
    source.addEventListener('error', () => {
      setLiveConnected(false);
      setState((current) => ({ ...current, connected: false }));
    });
    source.addEventListener('progress', (event) => {
      const { running } = JSON.parse(
        (event as MessageEvent<string>).data
      ) as LiveProgressMessage;
      client.setQueryData<DashboardResponse>(['dashboard'], (old) =>
        old ? { ...old, running } : old
      );
      const changed = (previous?.runId ?? null) !== (running?.runId ?? null);
      // 実行が、始まった・終わった・別の実行になった: 集計と一覧が変わるので、読み直す
      if (previous !== undefined && changed) {
        for (const key of ['dashboard', 'runs', 'run', 'info']) {
          void client.invalidateQueries({ queryKey: [key] });
        }
      } else if (running && Date.now() - lastDetail >= DETAIL_REFRESH_MS) {
        lastDetail = Date.now();
        void client.invalidateQueries({ queryKey: ['run', running.runId] });
        void client.invalidateQueries({ queryKey: ['runs'] });
      }
      previous = running;
      setState((current) => ({ ...current, running }));
    });
    source.addEventListener('log', (event) => {
      const { events } = JSON.parse(
        (event as MessageEvent<string>).data
      ) as LiveLogMessage;
      setState((current) => ({
        ...current,
        logs: [...current.logs, ...events].slice(-MAX_LOGS),
      }));
    });
    return () => {
      source.close();
      setLiveConnected(false);
    };
  }, [client, enabled]);

  const value = useMemo(() => state, [state]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
