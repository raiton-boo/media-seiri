import { statfsSync } from 'node:fs';
import { type EventRecord, listEventsAfter } from '@file-seiri/ledger';
import type { IngestProgress, ProgressBegin } from './progress.ts';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogLine = {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
};

export const STAGES = ['スキャン', '解析', 'コピー', '検証'] as const;
export type Stage = (typeof STAGES)[number];

export type InFlight = {
  stage: Stage;
  file: string;
  megabytes: number;
  ratio: number;
};

/** 画面が読む、ある時点の状態 */
export type LiveSnapshot = {
  runId: number;
  isDryRun: boolean;
  source: string;
  destination: string;
  sourceIndex: number;
  sourceCount: number;
  phase: string;
  counts: {
    found: number;
    analyzed: number;
    analyzeTotal: number;
    copied: number;
    copyTotal: number;
    verified: number;
    verifyFailed: number;
  };
  bytes: { copied: number; copyTotal: number };
  counters: {
    adopted: number;
    duplicate: number;
    fallback: number;
    error: number;
  };
  types: { photo: number; video: number; raw: number; zip: number };
  dateSources: { metadata: number; filename: number; none: number };
  inFlight: InFlight[];
  zip: { name: string; entry: number; entries: number } | undefined;
  freeBytes: number | undefined;
  digest: { source: string; verifying: boolean } | undefined;
  /** 経過時間(ミリ秒) */
  timing: { analyze: number; copy: number; verify: number };
  /** コピーの速さ(バイト/秒)・検証の速さ(平均) */
  verifyBytesPerSecond: number;
  /** 新しく読んだログ(前回の `drainLogs` から) */
  logs: LogLine[];
};

const MEGABYTE = 1024 * 1024;
const MAX_LOG_LINES = 300;

const formatClock = (date: Date): string => date.toTimeString().slice(0, 8);

const levelOf = (level: EventRecord['level']): LogLevel | undefined =>
  level === 'DEBUG' ? undefined : level;

/** `a.zip!/inner/b.jpg` の、ZIP の部分(`a.zip`)。ZIP の中でなければ、undefined */
const zipPartOf = (relPath: string): string | undefined => {
  const index = relPath.indexOf('!/');
  return index < 0 ? undefined : relPath.slice(0, index);
};

/** 進み具合を集めたもの。取り込みが呼ぶ口(`IngestProgress`)と、画面が読む口 */
export type LiveFeed = IngestProgress & {
  /** いまの状態(`begin` の前は、なし)。呼ぶたびに、前回から増えたログが、`logs` に入る */
  snapshot: () => LiveSnapshot | undefined;
  /** 取り込みの経過の、すべてのログ(古い順。最大 300 行) */
  logsAll: () => LogLine[];
  /** 注意以上(WARN・ERROR)のログの、最近のもの */
  alerts: () => LogLine[];
  /** コピーの速さの標本を、1 つ足す(画面が 0.5 秒ごとに呼ぶ) */
  sampleSpeed: () => void;
  /** コピーの速さの履歴(バイト/秒。0.5 秒ごと) */
  speeds: () => number[];
};

/**
 * 取り込みの進み具合を、集める(`IngestProgress` の実装)。画面は、`snapshot()` を一定の間隔で読む。
 * 件数(採用・重複・フォールバック・エラー)は、取り込みの件数のまとめ(`summary`)から読む。ログの行は、台帳のイベントから読む。
 */
export const createFeed = (): LiveFeed => {
  let info: ProgressBegin | undefined;
  let phase = '解析';
  const counts = {
    found: 0,
    analyzed: 0,
    analyzeTotal: 0,
    copied: 0,
    copyTotal: 0,
    verified: 0,
    verifyFailed: 0,
  };
  const bytes = { copied: 0, copyTotal: 0 };
  const types = { photo: 0, video: 0, raw: 0, zip: 0 };
  const analyzing = new Map<string, number>();
  let analyzingOrder: string[] = [];
  let copying:
    | {
        file: string;
        size: number;
        written: number;
        hash: string;
        verifying: boolean;
      }
    | undefined;
  let zipSizes: ReadonlyMap<string, number> = new Map();
  const zipDone = new Map<string, number>();
  let currentZip: string | undefined;
  const timing = { analyze: 0, copy: 0, verify: 0 };
  let analyzeStartedAt: number | undefined;
  let copyStartedAt: number | undefined;
  let verifyStartedAt: number | undefined;
  let verifyBytes = 0;
  let verifyMs = 0;
  let lastEventId = 0;
  let nextLogId = 0;
  let logs: LogLine[] = [];
  let pending: LogLine[] = [];
  const speeds: number[] = [];
  let lastSampleBytes = 0;
  let lastSampleAt: number | undefined;

  // 台帳を閉じたあと(`end`)は、読まない(画面は、少し遅れて、最後の描画をするため)
  let finished = false;

  const readLogs = (): void => {
    if (!info || finished) return;
    let events: EventRecord[];
    try {
      events = listEventsAfter(info.db, info.runId, lastEventId, 200);
    } catch {
      // 台帳が、すでに閉じている。ログの表示は、補助なので、止めない
      finished = true;
      return;
    }
    for (const event of events) {
      lastEventId = event.eventId;
      const level = levelOf(event.level);
      if (!level) continue;
      const line: LogLine = {
        id: nextLogId++,
        time: formatClock(new Date(event.occurredAt)),
        level,
        message: event.message,
      };
      logs.push(line);
      pending.push(line);
    }
    if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
  };

  return {
    begin: (next) => {
      info = next;
      finished = false;
      phase = 'スキャン';
      Object.assign(counts, {
        found: 0,
        analyzed: 0,
        analyzeTotal: 0,
        copied: 0,
        copyTotal: 0,
        verified: 0,
        verifyFailed: 0,
      });
      Object.assign(bytes, { copied: 0, copyTotal: 0 });
      lastEventId = 0;
      analyzing.clear();
      analyzingOrder = [];
      copying = undefined;
      zipDone.clear();
      currentZip = undefined;
    },
    scanned: (found) => {
      counts.found = found.found;
      types.photo = found.photos;
      types.video = found.videos;
      types.raw = found.raws;
      types.zip = found.zipEntries;
      zipSizes = found.zipSizes;
      phase = '解析';
      analyzeStartedAt = Date.now();
    },
    analyzeTotal: (total) => {
      counts.analyzeTotal = total;
    },
    analyzeStart: (file) => {
      analyzing.set(file, Date.now());
      analyzingOrder = [
        ...analyzingOrder.filter((item) => item !== file),
        file,
      ];
      const zip = zipPartOf(file);
      if (zip) currentZip = zip;
    },
    analyzeDone: (file) => {
      analyzing.delete(file);
      analyzingOrder = analyzingOrder.filter((item) => item !== file);
      counts.analyzed += 1;
      const zip = zipPartOf(file);
      if (zip) zipDone.set(zip, (zipDone.get(zip) ?? 0) + 1);
      if (
        counts.analyzed >= counts.analyzeTotal &&
        analyzeStartedAt !== undefined
      ) {
        timing.analyze = Date.now() - analyzeStartedAt;
        analyzeStartedAt = undefined;
      }
    },
    planned: (copyFiles, copyBytes) => {
      counts.copyTotal = copyFiles;
      bytes.copyTotal = copyBytes;
      if (analyzeStartedAt !== undefined) {
        timing.analyze = Date.now() - analyzeStartedAt;
        analyzeStartedAt = undefined;
      }
      phase = 'コピー';
    },
    copyStart: (file, size, hash) => {
      copying = { file, size, written: 0, hash, verifying: false };
      copyStartedAt = Date.now();
      const zip = zipPartOf(file);
      if (zip) currentZip = zip;
    },
    copyChunk: (written) => {
      if (copying) {
        bytes.copied += written - copying.written;
        copying.written = written;
      }
    },
    copyVerifying: () => {
      if (!copying) return;
      copying.verifying = true;
      const now = Date.now();
      if (copyStartedAt !== undefined) timing.copy += now - copyStartedAt;
      verifyStartedAt = now;
    },
    copyDone: (ok) => {
      const now = Date.now();
      if (copying && verifyStartedAt !== undefined) {
        const elapsed = now - verifyStartedAt;
        timing.verify += elapsed;
        verifyMs += elapsed;
        verifyBytes += copying.size;
      } else if (copyStartedAt !== undefined) {
        timing.copy += now - copyStartedAt;
      }
      counts.copied += 1;
      if (ok) counts.verified += 1;
      else counts.verifyFailed += 1;
      copying = undefined;
      copyStartedAt = undefined;
      verifyStartedAt = undefined;
    },
    phase: (name) => {
      phase = name;
    },
    end: () => {
      // 最後の分を読んでから、台帳を、読まなくする
      readLogs();
      finished = true;
      phase = '完了';
    },

    sampleSpeed: () => {
      const now = Date.now();
      if (lastSampleAt === undefined) {
        lastSampleAt = now;
        lastSampleBytes = bytes.copied;
        return;
      }
      const seconds = Math.max((now - lastSampleAt) / 1000, 0.001);
      speeds.push((bytes.copied - lastSampleBytes) / seconds);
      if (speeds.length > 240) speeds.shift();
      lastSampleAt = now;
      lastSampleBytes = bytes.copied;
    },
    speeds: () => speeds,
    logsAll: () => {
      readLogs();
      return logs;
    },
    alerts: () => logs.filter((line) => line.level !== 'INFO').slice(-4),

    snapshot: () => {
      if (!info) return undefined;
      readLogs();
      const summary = info.summary;
      const fallback = summary.fallbackJson + summary.fallbackFilename;
      const none = summary.unknownNone + summary.unknownInvalid;
      const copyPlanned = Math.max(summary.copyFiles, 0);
      const inFlight: InFlight[] = [];
      const latestAnalyzing = analyzingOrder[analyzingOrder.length - 1];
      if (latestAnalyzing)
        inFlight.push({
          stage: '解析',
          file: latestAnalyzing,
          megabytes: 0,
          ratio:
            counts.analyzeTotal > 0 ? counts.analyzed / counts.analyzeTotal : 0,
        });
      if (copying)
        inFlight.push({
          stage: copying.verifying ? '検証' : 'コピー',
          file: copying.file,
          megabytes: copying.size / MEGABYTE,
          ratio: copying.size > 0 ? copying.written / copying.size : 1,
        });
      const zipName = currentZip;
      const zipTotal = zipName ? (zipSizes.get(zipName) ?? 0) : 0;
      let snapshotLogs: LogLine[] = [];
      snapshotLogs = pending;
      pending = [];
      return {
        runId: info.runId,
        isDryRun: info.isDryRun,
        source: info.source,
        destination: info.destination,
        sourceIndex: info.sourceIndex,
        sourceCount: info.sourceCount,
        phase,
        counts: { ...counts, copyTotal: counts.copyTotal || copyPlanned },
        bytes: { ...bytes },
        counters: {
          adopted: summary.copy?.copied ?? 0,
          duplicate: summary.duplicatesInLibrary + summary.duplicatesInRun,
          fallback,
          error: summary.errorFiles,
        },
        types: { ...types },
        dateSources: {
          metadata: Math.max(0, summary.copyFiles - fallback - none),
          filename: summary.fallbackFilename,
          none,
        },
        inFlight,
        zip: zipName
          ? {
              name: zipName.split('/').pop() ?? zipName,
              entry: zipDone.get(zipName) ?? 0,
              entries: zipTotal,
            }
          : undefined,
        freeBytes: freeBytesOf(info.destinationRoot),
        digest: copying
          ? { source: copying.hash, verifying: copying.verifying }
          : undefined,
        timing: { ...timing },
        verifyBytesPerSecond:
          verifyMs > 0 ? verifyBytes / (verifyMs / 1000) : 0,
        logs: snapshotLogs,
      };
    },
  };
};

const freeBytesOf = (path: string): number | undefined => {
  try {
    const stats = statfsSync(path);
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
};
