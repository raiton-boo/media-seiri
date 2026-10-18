import type {
  AlbumOrder,
  AlbumPhoto,
  AlbumSection,
  BrowsedError,
  DashboardSummary,
  DuplicateGroup,
  DuplicateGroupDetail,
  EventDetail,
  EventStack,
  FallbackRow,
  FallbackSource,
  FilterOptions,
  MediaKind,
  MonthSummary,
  OnThisDay,
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

/** ソースのドライブの選択肢 */
export type VolumeOption = { volumeId: number; label: string | null };

export type FallbackResponse = Page & {
  items: FallbackRow[];
  /** 取得元ごとの件数(絞り込みは、反映しない。カードに、全体を出すため) */
  counts: Record<FallbackSource, number>;
  volumes: VolumeOption[];
};

export type DupesResponse = Page & {
  items: DuplicateGroup[];
  /** 絞り込みに合う、スキップしたファイルの数 */
  totalSkipped: number;
  volumes: VolumeOption[];
  /** 実行の選択肢(新しい順) */
  runs: RunSummary[];
};

export type DupeDetailResponse = DuplicateGroupDetail;

/** アルバムの全体: 年ごとの枚数(時間の定規と、入口の最新の年に使う) */
export type AlbumOverviewResponse = {
  order: AlbumOrder;
  years: { year: number; count: number }[];
  /** 日付のない枚数 */
  undated: number;
  total: number;
  /** 写真のある、いちばん新しい年。1 枚もなければ null */
  latestYear: number | null;
};

export type AlbumYearResponse = {
  year: number;
  order: AlbumOrder;
  /** 12 か月ぶん(枚数 0 の月も含む)。並びは `order` に従う */
  months: MonthSummary[];
  total: number;
};

export type AlbumMonthResponse = {
  year: number;
  month: number;
  order: AlbumOrder;
  /** この月の枚数 */
  total: number;
  /** できごと(3 枚以上)。束にして置く */
  events: EventStack[];
  /** 小さなできごと(3 枚未満)。まとめて、あとで見せる */
  small: EventStack[];
};

export type AlbumEventResponse = EventDetail & {
  order: AlbumOrder;
  limit: number;
  offset: number;
};

export type AlbumMemoriesResponse = {
  onThisDay: OnThisDay[];
  photoOfDay: AlbumPhoto | null;
};

/** 「すべて」の区画の一覧(表示の順)。絞り込みに合うものだけ */
export type AlbumSectionsResponse = {
  order: AlbumOrder;
  total: number;
  sections: AlbumSection[];
};

/** 1 つの区画の写真(`year` 0 = 日付なし、`month` 0 = 月不明) */
export type AlbumSectionPhotosResponse = {
  year: number;
  month: number;
  order: AlbumOrder;
  photos: AlbumPhoto[];
};

/** 絞り込みの引き出し: 項目ごとの選択肢と件数 */
export type AlbumFiltersResponse = FilterOptions;
