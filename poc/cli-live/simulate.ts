export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogLine = {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
};
export type Counters = {
  adopted: number;
  duplicate: number;
  fallback: number;
  error: number;
};

/** 1 ファイルあたりの処理の段階(`cli-logging.md` §4) */
export const STAGES = ['スキャン', 'ハッシュ', 'コピー', '検証'] as const;
export type Stage = (typeof STAGES)[number];

/** 種別の内訳(ZIP の中の写真は、zip) */
export type TypeCounts = {
  photo: number;
  video: number;
  raw: number;
  zip: number;
};
/** 日付の取得元の内訳(仕様書 §3) */
export type DateSourceCounts = {
  metadata: number;
  filename: number;
  none: number;
};
/** 段階ごとに、そこまで進んだファイル数。スキャンが先を走り、検証が最後に続く */
export type StageCounts = {
  scan: number;
  hash: number;
  copy: number;
  verify: number;
};
/** 展開中の ZIP(入れ子の深さと、エントリの進み) */
export type ZipProgress = {
  name: string;
  entry: number;
  entries: number;
  depth: number;
};
/** いま処理中のファイル(段階ごとに 1 つ) */
export type InFlightFile = { stage: Stage; file: string; megabytes: number };

export type Snapshot = {
  processed: number;
  total: number;
  counters: Counters;
  currentFile: string;
  stage: Stage;
  /** 前回の呼び出しから、新しくできたログ */
  newLogs: LogLine[];
  bytesProcessed: number;
  bytesTotal: number;
  types: TypeCounts;
  dateSources: DateSourceCounts;
  stageCounts: StageCounts;
  inFlight: InFlightFile[];
  /** ZIP を展開しているときだけ */
  zip: ZipProgress | undefined;
};

// 全角文字を含む名前も混ぜる(表示の幅の確認のため)。実在のファイルではない
const SAMPLE_PATHS = [
  '2019/DCIM/100CANON/IMG_4821.CR3',
  '2014/スマホ/新しいフォルダー/IMG_0412.JPG',
  '2016/運動会/動画/MOV_0033.MPG',
  '2021/旅行(北海道)/PXL_20210501_123456789.jpg',
  '2015/15-09-06-15-48-35-995_photo.jpg',
  '2018/卒業式/DSC_9999.JPG',
];

const DUPLICATE_RATE = 0.04;
const ERROR_RATE = 0.002;
// 日付の取得元の割合(PoC #6 の実データの傾向)
const FILENAME_DATE_RATE = 0.18;
const NO_DATE_RATE = 0.07;
// 種別の割合(同上)
const VIDEO_RATE = 0.15;
const ZIP_ENTRY_RATE = 0.03;
const RAW_RATE = 0.004;
// 段階の先行(スキャンは先を走り、ハッシュ・コピーは数件先を処理中)
const SCAN_LEAD = 400;
const HASH_LEAD = 6;
const COPY_LEAD = 3;
// 1 ファイルの大きさ(MB)。写真は小さく、動画は大きい
const PHOTO_MEGABYTES = 4;
const VIDEO_MEGABYTES = 38;
const AVERAGE_MEGABYTES = 8.15;
const MEGABYTE = 1024 * 1024;

// 模擬: 一定の間隔ごとに、ZIP を展開している時間帯を作る
const ZIP_WINDOW = 700;
const ZIP_ENTRIES = 198;
const ZIP_NAME = 'スマホ2014年4月～6月.zip';

const BASE_SEED = 1;
const MAX_UINT32 = 4294967296;

/** 再現できる乱数(同じ種なら、同じ並びになる) */
const createRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / MAX_UINT32;
  };
};

const formatTime = (date: Date): string => date.toTimeString().slice(0, 8);

// 画面の一覧で、行を見分けるための通し番号
let nextLogId = 0;
const createLog = (time: Date, level: LogLevel, message: string): LogLine => ({
  id: nextLogId++,
  time: formatTime(time),
  level,
  message,
});

const pathAt = (index: number): string =>
  SAMPLE_PATHS[index % SAMPLE_PATHS.length] ?? '';

/** 取り込みの経過を模擬する。実際には、ファイルを読み書きしない */
export const createSimulation = (total: number) => {
  const random = createRandom(BASE_SEED);
  const counters: Counters = {
    adopted: 0,
    duplicate: 0,
    fallback: 0,
    error: 0,
  };
  const types: TypeCounts = { photo: 0, video: 0, raw: 0, zip: 0 };
  const dateSources: DateSourceCounts = { metadata: 0, filename: 0, none: 0 };
  let processed = 0;
  let bytesProcessed = 0;
  let currentFile = pathAt(0);

  const snapshotOf = (newLogs: LogLine[]): Snapshot => ({
    processed,
    total,
    counters: { ...counters },
    currentFile,
    stage: STAGES[processed % STAGES.length] ?? 'スキャン',
    newLogs,
    bytesProcessed,
    bytesTotal: total * AVERAGE_MEGABYTES * MEGABYTE,
    types: { ...types },
    dateSources: { ...dateSources },
    stageCounts: {
      scan: Math.min(total, processed + SCAN_LEAD),
      hash: Math.min(total, processed + HASH_LEAD),
      copy: Math.min(total, processed + COPY_LEAD),
      verify: processed,
    },
    zip:
      Math.floor(processed / ZIP_WINDOW) % 4 === 3
        ? {
            name: ZIP_NAME,
            entry: ((processed % ZIP_WINDOW) % ZIP_ENTRIES) + 1,
            entries: ZIP_ENTRIES,
            depth: 1,
          }
        : undefined,
    inFlight: [
      {
        stage: 'スキャン',
        file: pathAt(processed + SCAN_LEAD),
        megabytes: PHOTO_MEGABYTES,
      },
      {
        stage: 'ハッシュ',
        file: pathAt(processed + HASH_LEAD),
        megabytes: VIDEO_MEGABYTES / 4,
      },
      {
        stage: 'コピー',
        file: pathAt(processed + COPY_LEAD),
        megabytes: VIDEO_MEGABYTES / 2,
      },
      {
        stage: '検証',
        file: pathAt(processed),
        megabytes: PHOTO_MEGABYTES * 2,
      },
    ],
  });

  return {
    get processed() {
      return processed;
    },
    /** fileCount 個のファイルの処理が進んだことにして、状態を返す */
    advance(fileCount: number): Snapshot {
      const newLogs: LogLine[] = [];
      const now = new Date();
      for (let count = 0; count < fileCount && processed < total; count++) {
        processed++;
        currentFile = pathAt(processed);

        // 種別と、1 ファイルの大きさ
        const typeDraw = random();
        let megabytes = PHOTO_MEGABYTES * (0.4 + random() * 1.2);
        if (typeDraw < RAW_RATE) types.raw++;
        else if (typeDraw < RAW_RATE + ZIP_ENTRY_RATE) types.zip++;
        else if (typeDraw < RAW_RATE + ZIP_ENTRY_RATE + VIDEO_RATE) {
          types.video++;
          megabytes = VIDEO_MEGABYTES * (0.3 + random() * 1.4);
        } else types.photo++;
        bytesProcessed += megabytes * MEGABYTE;

        // 結果(エラー・重複・採用)
        const draw = random();
        if (draw < ERROR_RATE) {
          counters.error++;
          newLogs.push(
            createLog(now, 'ERROR', `HASH_MISMATCH: ${currentFile}`)
          );
        } else if (draw < ERROR_RATE + DUPLICATE_RATE) {
          counters.duplicate++;
          newLogs.push(createLog(now, 'INFO', `重複スキップ: ${currentFile}`));
        } else {
          counters.adopted++;
          // 日付の取得元(本体のメタデータ → ファイル名 → なし)
          const dateDraw = random();
          if (dateDraw < NO_DATE_RATE) {
            dateSources.none++;
            counters.fallback++;
            newLogs.push(
              createLog(
                now,
                'WARN',
                `日付なし → _unknown/日付なし: ${currentFile}`
              )
            );
          } else if (dateDraw < NO_DATE_RATE + FILENAME_DATE_RATE) {
            dateSources.filename++;
            counters.fallback++;
            newLogs.push(
              createLog(
                now,
                'WARN',
                `日付フォールバック(filename): ${currentFile}`
              )
            );
          } else {
            dateSources.metadata++;
            newLogs.push(createLog(now, 'INFO', `採用: ${currentFile}`));
          }
        }
      }
      return snapshotOf(newLogs);
    },
  };
};
