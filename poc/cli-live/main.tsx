import { Box, render, renderToString, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { formatLog } from './format.ts';
import { createSimulation, type LogLine, type Snapshot } from './simulate.ts';
import { BtopView } from './views/btop.tsx';
import { CipherView } from './views/cipher.tsx';
import { CyberView } from './views/cyber.tsx';
import { DashboardView } from './views/dashboard.tsx';
import { MinimalView } from './views/minimal.tsx';
import { NeoView } from './views/neo.tsx';
import { RetroView } from './views/retro.tsx';
import { Summary } from './views/summary.tsx';
import { SynthView } from './views/synth.tsx';
import type { StyleName, SystemStats, ViewProps } from './views/types.ts';

// 使い方: bun main.tsx [--plain]
// 環境変数: STYLE(neo / dashboard / minimal / cyber / cipher / synth / btop / retro。既定 btop)、RATE(1 秒あたりのファイル数。既定 300)、TOTAL(既定 15610)
// 標準出力がターミナルでない(パイプ・リダイレクト)ときと、--plain のときは、ログの行だけを出す
const DEFAULT_TOTAL = 15610;
const DEFAULT_RATE = 300;
const TICK_MILLISECONDS = 50;
const VISIBLE_LOG_COUNT = 6;
const VISIBLE_ALERT_COUNT = 4;
// 速度のグラフの幅に足りる長さ(広い画面でも、左が空かないように)
const HISTORY_LENGTH = 240;
const SAMPLE_INTERVAL_MILLISECONDS = 500;
const MAX_RENDER_FPS = 30;
const EXIT_CODE_INTERRUPTED = 130;
const STOP_DELAY_MILLISECONDS = 200;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_COLUMNS = 80;
// 速さに、ゆるやかな増減をつける(速度のグラフの確認のため)
const RATE_WAVE_AMPLITUDE = 0.35;
const RATE_WAVE_PERIOD_MILLISECONDS = 6000;

const STYLES: Record<StyleName, (props: ViewProps) => React.ReactNode> = {
  neo: NeoView,
  dashboard: DashboardView,
  minimal: MinimalView,
  cyber: CyberView,
  cipher: CipherView,
  synth: SynthView,
  btop: BtopView,
  retro: RetroView,
};

const total = Number(process.env.TOTAL ?? DEFAULT_TOTAL);
const rate = Number(process.env.RATE ?? DEFAULT_RATE);
const requestedStyle = process.env.STYLE ?? 'btop';
const styleName: StyleName =
  requestedStyle in STYLES ? (requestedStyle as StyleName) : 'neo';
const isPlain = process.argv.includes('--plain') || !process.stdout.isTTY;

/** ある時点の、1 秒あたりのファイル数(増減つき) */
const rateAt = (elapsedMilliseconds: number): number =>
  rate *
  (1 +
    RATE_WAVE_AMPLITUDE *
      Math.sin(
        (2 * Math.PI * elapsedMilliseconds) / RATE_WAVE_PERIOD_MILLISECONDS
      ));

// ---------- Ink の外で、終了コードと最後の状態を決めるための入れ物 ----------
const outcome = {
  interrupted: false,
  elapsed: 0,
  snapshot: createSimulation(total).advance(0),
};

/** 時間とともに、模擬の処理を進める。進んだ分(ファイル数)を返す */
const createClock = () => {
  const simulation = createSimulation(total);
  let lastTick = Date.now();
  let carried = 0;
  return {
    simulation,
    tick(elapsedMilliseconds: number): Snapshot {
      const now = Date.now();
      carried +=
        (rateAt(elapsedMilliseconds) * (now - lastTick)) /
        MILLISECONDS_PER_SECOND;
      lastTick = now;
      const whole = Math.floor(carried);
      carried -= whole;
      return simulation.advance(Math.min(whole, total - simulation.processed));
    },
    /** 一時停止している間は、時間が進んだことにしない */
    skip() {
      lastTick = Date.now();
    },
  };
};

// ---------- スリープの抑止 ----------
/**
 * 取り込み中に、Mac がスリープしないようにする(約 55 分かかるため)。
 * caffeinate は、-w で指定したプロセス(このプロセス)が終わると、自動で終わる。
 * macOS 以外や、コマンドがない場合は、起動できず、false を返す。
 */
const startSleepGuard = (): { active: boolean; stop: () => void } => {
  try {
    const child = Bun.spawn(['caffeinate', '-i', '-w', String(process.pid)], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return { active: true, stop: () => child.kill() };
  } catch {
    return { active: false, stop: () => undefined };
  }
};
const sleepGuard = startSleepGuard();

// ---------- ログの行だけを出す表示 ----------
const runPlain = () =>
  new Promise<void>((resolve) => {
    const clock = createClock();
    const startedAt = Date.now();
    const finish = () => {
      clearInterval(timer);
      resolve();
    };
    process.on('SIGINT', () => {
      outcome.interrupted = true;
      finish();
    });
    const timer = setInterval(() => {
      outcome.elapsed = Date.now() - startedAt;
      outcome.snapshot = clock.tick(outcome.elapsed);
      for (const log of outcome.snapshot.newLogs) console.log(formatLog(log));
      if (outcome.snapshot.processed >= total) finish();
    }, TICK_MILLISECONDS);
  });

// ---------- Ink のライブ表示 ----------
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MICROSECONDS_PER_MILLISECOND = 1000;
const PERCENT_SCALE = 100;
const DEFAULT_ROWS = 40;

/** このプロセスの、実際の CPU 使用率(1 コアを 100% として)とメモリ */
const measureSystem = (
  previous: NodeJS.CpuUsage,
  elapsedMilliseconds: number
): SystemStats => {
  const usage = process.cpuUsage(previous);
  const usedMilliseconds =
    (usage.user + usage.system) / MICROSECONDS_PER_MILLISECOND;
  return {
    cpuPercent:
      (usedMilliseconds / Math.max(elapsedMilliseconds, 1)) * PERCENT_SCALE,
    memoryMegabytes: process.memoryUsage().rss / BYTES_PER_MEGABYTE,
  };
};

const ALL_LOG_COUNT = 300;
const NOTICE_MILLISECONDS = 3000;
const WEB_NOTICE =
  'w: Web を開く(PoC では未実装。本実装では、このブラウザで結果の画面を開く)';

type LiveState = {
  system: SystemStats;
  snapshot: Snapshot;
  logs: LogLine[];
  logsAll: LogLine[];
  alerts: LogLine[];
  history: number[];
  elapsed: number;
};

const App = () => {
  const { exit } = useApp();
  const [clock] = useState(createClock);
  const [state, setState] = useState<LiveState>(() => ({
    system: measureSystem(process.cpuUsage(), 1),
    snapshot: clock.simulation.advance(0),
    logs: [],
    logsAll: [],
    alerts: [],
    history: [],
    elapsed: 0,
  }));
  const [isStopping, setIsStopping] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [logView, setLogView] = useState(false);
  const [notice, setNotice] = useState('');
  // タイマーの中から、最新の「一時停止中か」を読むための入れ物
  const pausedRef = useRef(false);

  useEffect(() => {
    if (isStopping) return;
    const startedAt = Date.now();
    let pausedMilliseconds = 0;
    let lastTimerAt = startedAt;
    let lastSampleAt = startedAt;
    let lastSampleCount = 0;
    let lastCpuUsage = process.cpuUsage();
    let system = measureSystem(lastCpuUsage, 1);
    const timer = setInterval(() => {
      const now = Date.now();
      if (pausedRef.current) {
        // 一時停止中は、時間も、処理も、進めない
        pausedMilliseconds += now - lastTimerAt;
        lastSampleAt += now - lastTimerAt;
        lastTimerAt = now;
        clock.skip();
        return;
      }
      lastTimerAt = now;
      const elapsed = now - startedAt - pausedMilliseconds;
      const snapshot = clock.tick(elapsed);
      outcome.snapshot = snapshot;
      outcome.elapsed = elapsed;
      setState((previous) => {
        let history = previous.history;
        if (Date.now() - lastSampleAt >= SAMPLE_INTERVAL_MILLISECONDS) {
          const seconds = (Date.now() - lastSampleAt) / MILLISECONDS_PER_SECOND;
          history = [
            ...history,
            (snapshot.processed - lastSampleCount) / seconds,
          ].slice(-HISTORY_LENGTH);
          system = measureSystem(
            lastCpuUsage,
            seconds * MILLISECONDS_PER_SECOND
          );
          lastCpuUsage = process.cpuUsage();
          lastSampleAt = Date.now();
          lastSampleCount = snapshot.processed;
        }
        const logsAll = [...previous.logsAll, ...snapshot.newLogs].slice(
          -ALL_LOG_COUNT
        );
        return {
          snapshot,
          logs: logsAll.slice(-VISIBLE_LOG_COUNT),
          logsAll,
          alerts: [
            ...previous.alerts,
            ...snapshot.newLogs.filter((log) => log.level !== 'INFO'),
          ].slice(-VISIBLE_ALERT_COUNT),
          history,
          elapsed,
          system,
        };
      });
      if (snapshot.processed >= total) {
        clearInterval(timer);
        exit();
      }
    }, TICK_MILLISECONDS);
    return () => clearInterval(timer);
  }, [clock, exit, isStopping]);

  const stopSafely = () => {
    outcome.interrupted = true;
    setIsStopping(true);
    setTimeout(exit, STOP_DELAY_MILLISECONDS);
  };

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(''), NOTICE_MILLISECONDS);
  };

  // キー操作。Ctrl-C と q は、安全に停止して、画面を崩さずに終わる(仕様: cli-logging.md §8)
  useInput((input, key) => {
    if ((key.ctrl && input === 'c') || input === 'q') stopSafely();
    else if (input === 'p') {
      pausedRef.current = !pausedRef.current;
      setIsPaused(pausedRef.current);
    } else if (input === 'l') setLogView((previous) => !previous);
    else if (input === 'w') showNotice(WEB_NOTICE);
  });

  const { snapshot, elapsed } = state;
  const remaining =
    snapshot.processed > 0
      ? (elapsed / snapshot.processed) * (snapshot.total - snapshot.processed)
      : 0;
  const View = STYLES[styleName];
  return (
    <Box flexDirection="column">
      <View
        snapshot={snapshot}
        logs={state.logs}
        alerts={state.alerts}
        history={state.history}
        elapsed={elapsed}
        remaining={remaining}
        isStopping={isStopping}
        columns={process.stdout.columns ?? DEFAULT_COLUMNS}
        rows={process.stdout.rows ?? DEFAULT_ROWS}
        system={state.system}
        isPaused={isPaused}
        logView={logView}
        logsAll={state.logsAll}
        sleepGuard={sleepGuard.active}
        notice={notice}
      />
    </Box>
  );
};

const printSummary = () => {
  const columns = process.stdout.columns ?? DEFAULT_COLUMNS;
  if (isPlain) {
    const { counters, processed } = outcome.snapshot;
    console.log(
      `${outcome.interrupted ? '中断' : '完了'}: ${processed} / ${total} 件 / 採用 ${counters.adopted} 重複 ${counters.duplicate} フォールバック ${counters.fallback} エラー ${counters.error}`
    );
    return;
  }
  console.log(
    renderToString(
      <Summary
        snapshot={outcome.snapshot}
        elapsed={outcome.elapsed}
        interrupted={outcome.interrupted}
        width={columns}
      />,
      { columns }
    )
  );
};

const main = async () => {
  if (isPlain) {
    await runPlain();
  } else {
    // exitOnCtrlC を切り、Ctrl-C は、自前で処理する(画面を崩さずに終わるため)
    const instance = render(<App />, {
      exitOnCtrlC: false,
      maxFps: MAX_RENDER_FPS,
    });
    await instance.waitUntilExit();
  }
  printSummary();
  sleepGuard.stop();
  process.exit(outcome.interrupted ? EXIT_CODE_INTERRUPTED : 0);
};

await main();
