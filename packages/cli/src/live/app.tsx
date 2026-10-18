import { Box, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { LiveControls } from './controller.ts';
import type { LiveFeed, LiveSnapshot, LogLine } from './feed.ts';
import { LiveView } from './view.tsx';

const TICK_MS = 100;
const SAMPLE_INTERVAL_MS = 500;
const VISIBLE_LOG_COUNT = 6;
const NOTICE_MS = 3000;
const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 40;
const MICROSECONDS_PER_MILLISECOND = 1000;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const WEB_NOTICE =
  'w: 結果は Web で見られます(別の端末で `seiri viewer` を実行して、ブラウザで開く)';

type Props = {
  feed: LiveFeed;
  controls: LiveControls;
  sleepGuard: boolean;
  setPaused: (paused: boolean) => void;
  onForceExit: () => void;
  /** 取り込みが標準出力に出していた行(ログの欄に出す) */
  notes: string[];
};

/** このプロセスの、実際の CPU 使用率(1 コアを 100% として)とメモリ */
const measureSystem = (previous: NodeJS.CpuUsage, elapsedMs: number) => {
  const usage = process.cpuUsage(previous);
  const usedMs = (usage.user + usage.system) / MICROSECONDS_PER_MILLISECOND;
  return {
    cpuPercent: (usedMs / Math.max(elapsedMs, 1)) * 100,
    memoryMegabytes: process.memoryUsage().rss / BYTES_PER_MEGABYTE,
  };
};

type State = {
  snapshot: LiveSnapshot | undefined;
  logs: LogLine[];
  alerts: LogLine[];
  speeds: number[];
  elapsed: number;
  system: { cpuPercent: number; memoryMegabytes: number };
};

/** ライブ表示の画面。一定の間隔で、進み具合を読み直し、キー操作を受ける(p・l・w・q・Ctrl-C) */
export const LiveApp = ({
  feed,
  controls,
  sleepGuard,
  setPaused,
  onForceExit,
  notes,
}: Props) => {
  const { exit } = useApp();
  const [state, setState] = useState<State>(() => ({
    snapshot: feed.snapshot(),
    logs: [],
    alerts: [],
    speeds: [],
    elapsed: 0,
    system: measureSystem(process.cpuUsage(), 1),
  }));
  const [paused, setPausedState] = useState(controls.paused);
  const [stopping, setStopping] = useState(controls.stopRequested);
  const [logView, setLogView] = useState(false);
  const [notice, setNotice] = useState('');
  const interrupts = useRef(0);

  useEffect(() => {
    const startedAt = Date.now();
    let pausedMs = 0;
    let lastTickAt = startedAt;
    let lastSampleAt = startedAt;
    let lastCpu = process.cpuUsage();
    let system = measureSystem(lastCpu, 1);
    const timer = setInterval(() => {
      const now = Date.now();
      if (controls.paused) {
        // 一時停止中は、経過時間も、進めない
        pausedMs += now - lastTickAt;
        lastSampleAt += now - lastTickAt;
        lastTickAt = now;
        return;
      }
      lastTickAt = now;
      if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        feed.sampleSpeed();
        system = measureSystem(lastCpu, now - lastSampleAt);
        lastCpu = process.cpuUsage();
        lastSampleAt = now;
      }
      const snapshot = feed.snapshot();
      const all = feed.logsAll();
      const extra: LogLine[] = notes
        .slice(-VISIBLE_LOG_COUNT)
        .map((message, index) => ({
          id: -1 - index,
          time: new Date().toTimeString().slice(0, 8),
          level: 'INFO' as const,
          message,
        }));
      setState({
        snapshot,
        logs: [...all, ...extra].slice(-VISIBLE_LOG_COUNT),
        alerts: feed.alerts(),
        speeds: [...feed.speeds()],
        elapsed: now - startedAt - pausedMs,
        system,
      });
      setStopping(controls.stopRequested);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [feed, controls, notes]);

  const showNotice = (message: string): void => {
    setNotice(message);
    setTimeout(() => setNotice(''), NOTICE_MS);
  };

  // キー操作。Ctrl-C は、1 回目が「安全に停止」、続けて 2 回目が「強制終了」(仕様: cli-logging.md §8)
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      interrupts.current += 1;
      if (interrupts.current >= 2) {
        exit();
        onForceExit();
        return;
      }
      controls.stopRequested = true;
      setStopping(true);
      showNotice(
        '停止しています(今のファイルまで終えます)。もう一度 Ctrl-C で、強制終了します'
      );
    } else if (input === 'q') {
      controls.stopRequested = true;
      setStopping(true);
    } else if (input === 'p') {
      setPaused(!controls.paused);
      setPausedState(controls.paused);
    } else if (input === 'l') setLogView((previous) => !previous);
    else if (input === 'w') showNotice(WEB_NOTICE);
  });

  if (!state.snapshot) return <Box />;
  return (
    <Box flexDirection="column">
      <LiveView
        snapshot={state.snapshot}
        logs={state.logs}
        logsAll={feed.logsAll()}
        alerts={state.alerts}
        speeds={state.speeds}
        elapsed={state.elapsed}
        isStopping={stopping}
        isPaused={paused}
        logView={logView}
        sleepGuard={sleepGuard}
        notice={notice}
        columns={process.stdout.columns ?? DEFAULT_COLUMNS}
        rows={process.stdout.rows ?? DEFAULT_ROWS}
        system={state.system}
      />
    </Box>
  );
};
