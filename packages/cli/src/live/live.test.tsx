import { describe, expect, test } from 'bun:test';
import {
  IN_MEMORY,
  openLedger,
  recordEvent,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { renderToString } from 'ink';
import { emptySummary } from '../ingest/summary.ts';
import { createFeed, type LiveSnapshot } from './feed.ts';
import {
  formatDuration,
  miniBar,
  sparkline,
  truncateToWidth,
} from './format.ts';
import { neverPaused } from './progress.ts';
import { startSleepGuard } from './sleep-guard.ts';
import { LiveView, type ViewProps } from './view.tsx';

const snapshot = (overrides: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  runId: 3,
  isDryRun: false,
  source: 'Backup-copy',
  destination: 'PhotoLib',
  sourceIndex: 0,
  sourceCount: 1,
  phase: 'コピー',
  counts: {
    found: 1000,
    analyzed: 1000,
    analyzeTotal: 1000,
    copied: 400,
    copyTotal: 900,
    verified: 398,
    verifyFailed: 2,
  },
  bytes: { copied: 4 * 1024 ** 3, copyTotal: 9 * 1024 ** 3 },
  counters: { adopted: 400, duplicate: 80, fallback: 12, error: 2 },
  types: { photo: 800, video: 150, raw: 10, zip: 40 },
  dateSources: { metadata: 700, filename: 150, none: 50 },
  inFlight: [
    {
      stage: 'コピー',
      file: '2019/DCIM/100CANON/IMG_4821.CR3',
      megabytes: 24.5,
      ratio: 0.4,
    },
  ],
  zip: { name: 'phone.zip', entry: 20, entries: 40 },
  freeBytes: 1.5 * 1024 ** 4,
  digest: { source: 'a'.repeat(64), verifying: true },
  timing: { analyze: 60_000, copy: 40_000, verify: 30_000 },
  verifyBytesPerSecond: 70 * 1024 ** 2,
  logs: [],
  ...overrides,
});

const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  snapshot: snapshot(),
  logs: [
    {
      id: 1,
      time: '02:55:57',
      level: 'INFO',
      message: '2019/a.jpg → 2019/09/a.jpg',
    },
    {
      id: 2,
      time: '02:55:58',
      level: 'WARN',
      message: '日付フォールバック(filename): b.jpg',
    },
  ],
  logsAll: [
    {
      id: 1,
      time: '02:55:57',
      level: 'INFO',
      message: '2019/a.jpg → 2019/09/a.jpg',
    },
    {
      id: 2,
      time: '02:55:58',
      level: 'ERROR',
      message: 'ハッシュが一致しません',
    },
  ],
  alerts: [
    {
      id: 2,
      time: '02:55:58',
      level: 'WARN',
      message: '日付フォールバック(filename): b.jpg',
    },
  ],
  speeds: Array.from({ length: 60 }, (_, i) => (30 + (i % 10)) * 1024 ** 2),
  elapsed: 125_000,
  isStopping: false,
  isPaused: false,
  logView: false,
  sleepGuard: true,
  notice: '',
  columns: 120,
  rows: 50,
  system: { cpuPercent: 38, memoryMegabytes: 96 },
  ...overrides,
});

const render = (overrides: Partial<ViewProps> = {}): string =>
  renderToString(<LiveView {...props(overrides)} />, {
    columns: overrides.columns ?? 120,
  });

describe('LiveView(画面の作り)', () => {
  test('48 行以上: すべてのパネルと、キーの案内', () => {
    const out = render();
    for (const title of [
      'run #3',
      'throughput',
      'pipeline',
      'in flight',
      'breakdown',
      'integrity',
      'process',
      'recent files',
      'alerts',
    ]) {
      expect(out).toContain(title);
    }
    expect(out).toContain('採用 400');
    expect(out).toContain('重複 80');
    expect(out).toContain('エラー 2');
    expect(out).toContain('2019/DCIM/100CANON/IMG');
    expect(out).toContain('phone.zip');
    expect(out).toContain('スリープ抑止');
    expect(out).toContain(
      '[p]一時停止 [l]ログ全画面 [w]Web [q]または Ctrl-C 安全に停止'
    );
    // 4 GB / 9 GB(コピーの段階は、バイトで割合を出す)
    expect(out).toContain('44%');
    expect(out).toContain('400/900 files');
  });

  test('端末の行数が足りないと、優先度の低いパネルから省く(41〜47 行: integrity・process なし。28〜40 行: in flight・alerts もなし)', () => {
    const standard = render({ rows: 44 });
    expect(standard).toContain('in flight');
    expect(standard).not.toContain('integrity');
    const small = render({ rows: 30 });
    expect(small).toContain('recent files');
    expect(small).not.toContain('in flight');
    expect(small).not.toContain('alerts');
    const tiny = render({ rows: 20 });
    expect(tiny).toContain('pipeline');
    expect(tiny).not.toContain('recent files');
  });

  test('一時停止・停止中の札。ログの全画面', () => {
    expect(render({ isPaused: true })).toContain('一時停止中 (p で再開)');
    expect(render({ isStopping: true })).toContain('停止しています…');
    const logs = render({ logView: true });
    expect(logs).toContain('logs 全画面');
    expect(logs).toContain('ハッシュが一致しません');
    expect(logs).not.toContain('pipeline');
  });

  test('解析の段階: 解析の件数で割合を出す。dry-run の印。ソースが複数なら、何個目か', () => {
    const out = render({
      snapshot: snapshot({
        phase: '解析',
        isDryRun: true,
        sourceCount: 3,
        sourceIndex: 1,
        counts: {
          found: 1000,
          analyzed: 250,
          analyzeTotal: 1000,
          copied: 0,
          copyTotal: 0,
          verified: 0,
          verifyFailed: 0,
        },
        bytes: { copied: 0, copyTotal: 0 },
      }),
    });
    expect(out).toContain('dry-run');
    expect(out).toContain('2/3');
    expect(out).toContain('解析 250/1,000 files');
    expect(out).toContain('25%');
  });

  test('ZIP を展開していなければ「展開中の ZIP なし」。ファイルがなくても、崩れない', () => {
    expect(
      render({
        snapshot: snapshot({ zip: undefined, inFlight: [], digest: undefined }),
      })
    ).toContain('展開中の ZIP なし');
  });

  test('幅が狭くても、描画できる(80 桁)', () => {
    const out = render({ columns: 80 });
    expect(out).toContain('pipeline');
  });
});

describe('format', () => {
  test('時間・棒・省略', () => {
    expect(formatDuration(3_725_000)).toBe('01:02:05');
    expect(miniBar(0.5, 8)).toBe('▰▰▰▰▱▱▱▱');
    expect(sparkline([0, 5, 10], 3)).toHaveLength(3);
    expect(truncateToWidth('日本語のファイル名です', 9)).toBe('日本語の…');
    expect(truncateToWidth('abc', 9)).toBe('abc');
  });
});

describe('createFeed(進み具合の集計)', () => {
  const world = () => {
    const ledger = openLedger(IN_MEMORY, { libraryId: 'lib' });
    const volume = upsertVolume(ledger.db, {
      volumeUuid: 'v',
      seenAt: new Date('2026-10-18T00:00:00Z'),
    });
    const runId = startRun(ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: new Date('2026-10-18T00:00:00Z'),
    });
    return { ledger, runId };
  };
  const begin = (
    feed: ReturnType<typeof createFeed>,
    w: ReturnType<typeof world>,
    summary = emptySummary()
  ) =>
    feed.begin({
      runId: w.runId,
      isDryRun: false,
      db: w.ledger.db,
      source: 'Src',
      destination: 'Dst',
      destinationRoot: '/',
      sourceIndex: 0,
      sourceCount: 1,
      summary,
    });

  test('解析の間も、読んだ速さ(MB/s)が、速さのグラフに出る', async () => {
    const w = world();
    const feed = createFeed();
    begin(feed, w);
    feed.scanned({
      found: 3,
      photos: 3,
      videos: 0,
      raws: 0,
      zipEntries: 0,
      zipSizes: new Map(),
    });
    feed.analyzeTotal(3);
    feed.sampleSpeed();
    feed.analyzeStart('a.jpg');
    feed.analyzeDone('a.jpg', 50 * 1024 ** 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    feed.sampleSpeed();
    expect(feed.speeds().at(-1) ?? 0).toBeGreaterThan(0);
  });

  test('begin の前は、状態がない', () => {
    expect(createFeed().snapshot()).toBeUndefined();
  });

  test('段階ごとの件数・ZIP の進み・コピーの進み・件数のまとめ', () => {
    const w = world();
    const feed = createFeed();
    const summary = emptySummary();
    begin(feed, w, summary);
    feed.scanned({
      found: 5,
      photos: 3,
      videos: 1,
      raws: 1,
      zipEntries: 2,
      zipSizes: new Map([['DCIM/a.zip', 2]]),
    });
    feed.analyzeTotal(5);
    feed.analyzeStart('DCIM/a.zip!/1.jpg');
    let snap = feed.snapshot();
    expect(snap?.zip).toEqual({ name: 'a.zip', entry: 0, entries: 2 });
    expect(snap?.inFlight[0]).toMatchObject({
      stage: '解析',
      file: 'DCIM/a.zip!/1.jpg',
    });
    feed.analyzeDone('DCIM/a.zip!/1.jpg');
    feed.analyzeDone('DCIM/b.jpg');
    summary.copyFiles = 4;
    summary.fallbackFilename = 1;
    summary.unknownNone = 1;
    summary.duplicatesInLibrary = 1;
    feed.planned(4, 4000);
    feed.copyStart('DCIM/b.jpg', 1000, 'f'.repeat(64));
    feed.copyChunk(500);
    snap = feed.snapshot();
    expect(snap).toMatchObject({
      phase: 'コピー',
      counts: { found: 5, analyzed: 2, analyzeTotal: 5, copyTotal: 4 },
      bytes: { copied: 500, copyTotal: 4000 },
      types: { photo: 3, video: 1, raw: 1, zip: 2 },
      counters: { duplicate: 1, fallback: 1 },
      dateSources: { metadata: 2, filename: 1, none: 1 },
      digest: { source: 'f'.repeat(64), verifying: false },
    });
    expect(snap?.inFlight.at(-1)).toMatchObject({
      stage: 'コピー',
      ratio: 0.5,
    });
    feed.copyChunk(1000);
    feed.copyVerifying();
    expect(feed.snapshot()?.inFlight.at(-1)?.stage).toBe('検証');
    feed.copyDone(true);
    feed.copyStart('DCIM/c.jpg', 10, 'e'.repeat(64));
    feed.copyDone(false);
    snap = feed.snapshot();
    expect(snap?.counts).toMatchObject({
      copied: 2,
      verified: 1,
      verifyFailed: 1,
    });
    expect(snap?.bytes.copied).toBe(1000);
    expect(snap?.inFlight.filter((item) => item.stage !== '解析')).toEqual([]);
  });

  test('ログ: 台帳のイベントから読む(DEBUG は除く)。続きだけを読む。注意以上を別に持つ', () => {
    const w = world();
    const feed = createFeed();
    begin(feed, w);
    const at = new Date('2026-10-18T03:04:05');
    const event = (
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
      message: string
    ) =>
      recordEvent(w.ledger.db, {
        runId: w.runId,
        level,
        code: 'X',
        message,
        occurredAt: at,
      });
    event('DEBUG', '書き込みの先行記録');
    event('INFO', 'a を採用');
    event('WARN', '日付フォールバック');
    expect(feed.snapshot()?.logs.map((l) => [l.level, l.message])).toEqual([
      ['INFO', 'a を採用'],
      ['WARN', '日付フォールバック'],
    ]);
    // 2 回目は、新しい分だけ
    event('ERROR', 'ハッシュ不一致');
    expect(feed.snapshot()?.logs.map((l) => l.message)).toEqual([
      'ハッシュ不一致',
    ]);
    expect(feed.logsAll().map((l) => l.level)).toEqual([
      'INFO',
      'WARN',
      'ERROR',
    ]);
    expect(feed.alerts().map((l) => l.level)).toEqual(['WARN', 'ERROR']);
  });

  test('速さの標本: コピーしたバイトの増え方から', async () => {
    const w = world();
    const feed = createFeed();
    begin(feed, w);
    feed.copyStart('x', 10_000, 'a'.repeat(64));
    feed.sampleSpeed();
    feed.copyChunk(5000);
    await Bun.sleep(30);
    feed.sampleSpeed();
    expect(feed.speeds()).toHaveLength(1);
    expect(feed.speeds()[0]).toBeGreaterThan(0);
  });
});

describe('スリープの抑止(caffeinate)', () => {
  test('macOS では、`caffeinate -i -w <このプロセス>` を起動し、止められる', () => {
    const calls: string[][] = [];
    let killed = false;
    const guard = startSleepGuard('darwin', ((command: string[]) => {
      calls.push(command);
      return { kill: () => (killed = true) };
    }) as unknown as typeof Bun.spawn);
    expect(guard.active).toBe(true);
    expect(calls[0]).toEqual(['caffeinate', '-i', '-w', String(process.pid)]);
    guard.stop();
    expect(killed).toBe(true);
  });
  test('macOS 以外・コマンドがないときは、使えない(OFF)', () => {
    expect(startSleepGuard('linux').active).toBe(false);
    const guard = startSleepGuard('darwin', (() => {
      throw new Error('ENOENT');
    }) as unknown as typeof Bun.spawn);
    expect(guard.active).toBe(false);
  });
});

test('neverPaused は、いつも通る', async () => {
  expect(neverPaused.isPaused()).toBe(false);
  await neverPaused.wait();
});
