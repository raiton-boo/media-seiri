import type { Database } from 'bun:sqlite';
import type { IngestSummary } from '../ingest/summary.ts';

/** 1 つのソースの、始まりの情報 */
export type ProgressBegin = {
  runId: number;
  isDryRun: boolean;
  /** 台帳(ログの行を、ここから読む) */
  db: Database;
  source: string;
  destination: string;
  /** 保存先の根(空きを測る) */
  destinationRoot: string;
  sourceIndex: number;
  sourceCount: number;
  /** この実行の、件数のまとめ(処理が進むにつれて、中身が更新される) */
  summary: IngestSummary;
};

/** スキャンの結果の、内訳 */
export type ProgressScanned = {
  found: number;
  photos: number;
  videos: number;
  raws: number;
  /** ZIP の中のファイルの数 */
  zipEntries: number;
  /** ZIP ごとの、中のファイルの数(`a.zip` → n) */
  zipSizes: ReadonlyMap<string, number>;
};

/**
 * 取り込みの進み具合を、画面(ライブ表示)に伝える口。取り込みの処理は、これを呼ぶだけで、画面のことは、知らない。
 * 画面を使わないときは、何もしない版(`noopProgress`)。
 */
export type IngestProgress = {
  begin: (info: ProgressBegin) => void;
  scanned: (info: ProgressScanned) => void;
  /** 解析(メタデータ・ハッシュ)の対象の数が決まった */
  analyzeTotal: (total: number) => void;
  /** 解析を始めた / 終えた(同時に、複数) */
  analyzeStart: (file: string) => void;
  /** 解析を終えた(`sizeBytes`: 読んだ大きさ。解析中の速さ(MB/s)に使う) */
  analyzeDone: (file: string, sizeBytes?: number) => void;
  /** 計画ができた(コピーする数・サイズ) */
  planned: (copyFiles: number, copyBytes: number) => void;
  copyStart: (file: string, sizeBytes: number, hash: string) => void;
  /** いまのファイルを、ここまで書いた(バイト) */
  copyChunk: (writtenBytes: number) => void;
  /** 書き終えて、読み直して照合している */
  copyVerifying: () => void;
  copyDone: (ok: boolean) => void;
  /** いまの段階の名前(サムネイルの作成など)。画面の run パネルに出す */
  phase: (name: string) => void;
  end: () => void;
};

const nothing = (): void => {};

/** 画面を使わないときの、何もしない版 */
export const noopProgress: IngestProgress = {
  begin: nothing,
  scanned: nothing,
  analyzeTotal: nothing,
  analyzeStart: nothing,
  analyzeDone: nothing,
  planned: nothing,
  copyStart: nothing,
  copyChunk: nothing,
  copyVerifying: nothing,
  copyDone: nothing,
  phase: nothing,
  end: nothing,
};

/** 一時停止の関門。処理の合間に `wait()` を呼ぶと、一時停止中は、再開するまで、待つ */
export type PauseGate = {
  isPaused: () => boolean;
  wait: () => Promise<void>;
};

export const neverPaused: PauseGate = {
  isPaused: () => false,
  wait: async () => {},
};
