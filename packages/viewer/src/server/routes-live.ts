import {
  type EventRecord,
  getLatestRun,
  getRunningProgress,
  levelsAtLeast,
  listEventsAfter,
} from '@file-seiri/ledger';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { LiveLogMessage, LiveProgressMessage } from '../api-types.ts';
import type { ViewerSource } from './source.ts';

/** 台帳を見に行く間隔(ミリ秒)。変わったときだけ、送る */
const DEFAULT_INTERVAL_MS = 500;
/** 接続が生きていることを知らせる間隔(ミリ秒。途中の機器に、切られないように) */
const HEARTBEAT_MS = 15_000;
/** つないだとき、さかのぼって送る、ログの数 */
const INITIAL_LOGS = 20;
/** 1 回に送る、ログの最大 */
const MAX_BATCH = 200;
/** 画面に流す、ログの最低レベル(DEBUG は、多すぎる) */
const SHOWN_LEVELS = new Set<EventRecord['level']>(levelsAtLeast('INFO'));

/**
 * 実行状況のリアルタイム配信(SSE)。`GET /api/live`。この Mac の作業用の台帳のときだけ(スナップショットは、404)。
 * - `progress`: 実行中の取り込みの進み具合(なければ `running: null`)。変わったときだけ
 * - `log`: 新しいログ(INFO 以上)。つないだときは、直近のものを、さかのぼって送る
 * - `ping`: 生きていることの知らせ
 * 台帳は、読み取りだけ(WAL なので、取り込みの書き込みを、止めない)。
 */
export const registerLiveRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;
  app.get('/api/live', (context) => {
    if (source.source !== 'working') {
      return context.json({ error: 'live is available on this Mac only' }, 404);
    }
    const interval = source.liveIntervalMs ?? DEFAULT_INTERVAL_MS;
    return streamSSE(context, async (stream) => {
      let lastProgress: string | undefined;
      let runId: number | undefined;
      let cursor = 0;
      let lastBeat = Date.now();

      const sendLogs = async (events: EventRecord[]): Promise<void> => {
        const shown = events.filter((event) => SHOWN_LEVELS.has(event.level));
        if (shown.length === 0) return;
        const body: LiveLogMessage = { events: shown };
        await stream.writeSSE({ event: 'log', data: JSON.stringify(body) });
      };

      const tick = async (): Promise<void> => {
        const running = getRunningProgress(db) ?? null;
        const serialized = JSON.stringify(running);
        if (serialized !== lastProgress) {
          lastProgress = serialized;
          const body: LiveProgressMessage = { running };
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify(body),
          });
        }
        // ログは、実行中の実行のもの。なければ、直近の実行(終わった直後の、最後のログまで見せる)
        const target = running?.runId ?? getLatestRun(db)?.runId;
        if (target === undefined) return;
        if (target !== runId) {
          runId = target;
          const all = listEventsAfter(db, target, 0, Number.MAX_SAFE_INTEGER);
          cursor = all.at(-1)?.eventId ?? 0;
          await sendLogs(
            all
              .filter((event) => SHOWN_LEVELS.has(event.level))
              .slice(-INITIAL_LOGS)
          );
          return;
        }
        const fresh = listEventsAfter(db, target, cursor, MAX_BATCH);
        if (fresh.length > 0) {
          cursor = fresh.at(-1)?.eventId ?? cursor;
          await sendLogs(fresh);
        }
      };

      while (!stream.aborted && !stream.closed) {
        await tick();
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          lastBeat = Date.now();
          await stream.writeSSE({ event: 'ping', data: '' });
        }
        await stream.sleep(interval);
      }
    });
  });
};
