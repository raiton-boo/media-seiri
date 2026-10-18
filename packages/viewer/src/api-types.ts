import type {
  BrowsedError,
  DashboardSummary,
  MediaKind,
  RepairAttempt,
  RunDetail,
  RunningProgress,
  RunSummary,
} from '@file-seiri/ledger';

/** どの台帳を見ているか。この Mac では作業用の台帳(最新)、家の PC などでは、ドライブ内のスナップショット */
export type LedgerSource = 'working' | 'snapshot';

export type LibraryInfo = {
  /** ライブラリ ID(目印の `libraryId`) */
  id: string;
  /** 画面に出す名前(ドライブの名前。分からなければ、ライブラリのフォルダ名) */
  name: string;
  fsType: string | null;
  mediaKind: MediaKind | null;
};

/** 画面の共通の部分(上のナビのライブラリのチップ)が使う */
export type ViewerInfo = {
  library: LibraryInfo;
  source: LedgerSource;
  /** 台帳の鮮度(UTC の ISO 8601)。スナップショットなら、その保存時刻 */
  asOf: string;
};

/** ライブラリのドライブの容量。ドライブが接続されていなければ、null */
export type DiskUsage = { totalBytes: number; freeBytes: number };

export type DashboardResponse = ViewerInfo & {
  summary: DashboardSummary;
  runs: RunSummary[];
  /** 実行中の取り込み(この Mac の作業用の台帳のときだけ) */
  running: RunningProgress | null;
  disk: DiskUsage | null;
};

/** 一覧のページ送り */
export type Page = { total: number; limit: number; offset: number };

export type ErrorsResponse = Page & {
  items: BrowsedError[];
  /** コード別の件数(絞り込みのコードは、反映しない。札を、すべて出すため) */
  codes: { code: string; count: number }[];
  /** 実行の選択肢(新しい順) */
  runs: RunSummary[];
};

export type ErrorDetailResponse = {
  error: BrowsedError;
  attempts: RepairAttempt[];
};

export type RunsResponse = Page & { items: RunSummary[] };

export type RunDetailResponse = {
  run: RunDetail;
  library: LibraryInfo;
};
