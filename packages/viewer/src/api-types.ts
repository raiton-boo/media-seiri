import type {
  AlbumOrder,
  AlbumPhoto,
  AlbumSection,
  AutoAlbum,
  AutoEvent,
  BrowsedError,
  CalendarDay,
  DashboardSummary,
  DateGap,
  DaySummary,
  DuplicateGroup,
  DuplicateGroupDetail,
  EventDetail,
  EventStack,
  FallbackRow,
  FallbackSource,
  FilterOptions,
  MapCluster,
  MediaKind,
  MonthSummary,
  OnThisDay,
  PhotoDetail,
  PhotoStrip,
  RepairAttempt,
  RunDetail,
  RunningProgress,
  RunSummary,
  SearchSuggestion,
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
  /** ライブラリのドライブが、いま接続されているか(原本を開けるか。サムネイルの一覧は、外れていても見られる) */
  libraryConnected: boolean;
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

/** 検索の候補(入力中) */
export type SearchSuggestResponse = {
  suggestions: (SearchSuggestion | AreaSuggestion)[];
};

/** 地域(地名・都道府県・国)の候補。`value` は、地域の指定(`city:<ID>`・`pref:<2 桁>`・`country:<国コード>`) */
export type AreaSuggestion = {
  type: 'area';
  value: string;
  label: string;
  count: number;
};

/** 地域の指定の表示(札に出す名前) */
export type AreaLabelsResponse = { labels: Record<string, string> };

/** 検索の結果: 合う枚数と、先頭から `limit` 枚(「もっと広げる」で、増やす) */
export type SearchPhotosResponse = {
  order: AlbumOrder;
  total: number;
  limit: number;
  offset: number;
  photos: AlbumPhoto[];
};

/** 拡大表示の情報。原本をブラウザで表示できるか(`original`)も添える */
export type PhotoDetailResponse = {
  photo: PhotoDetail;
  /** GPS に近い地名(なければ null)。`ref` は、地域の指定(「この場所の写真」の検索に使う) */
  place: { label: string; ref: string } | null;
  original: {
    /** ブラウザで表示できる形か: 画像・動画・なし(HEIC・RAW など) */
    viewKind: 'image' | 'video' | null;
    /** ライブラリの原本が、いま読めるか(ドライブが接続されているか) */
    available: boolean;
  };
};

/** 前後の並び(フィルムストリップ) */
export type PhotoStripResponse = PhotoStrip & { order: AlbumOrder };

/** スライドショーの写真(表示の順。先頭から一定の枚数まで。`total` が、合う枚数の全部) */
export type SlideshowResponse = {
  order: AlbumOrder;
  total: number;
  photos: AlbumPhoto[];
};

/** カレンダー: 選べる年と、1 年の日ごとの枚数(写真のある日だけ)。年を省くと、いちばん新しい年 */
export type CalendarResponse = {
  /** 選べる年(新しい年が先)。絞り込みに合う、日まで分かる写真のある年 */
  years: { year: number; count: number }[];
  /** いま出している年(写真が 1 枚もなければ null) */
  year: number | null;
  days: CalendarDay[];
  total: number;
};

/** 選んだ日のまとめ */
export type CalendarDayResponse = DaySummary & { date: string };

/** 自動アルバム: できごと(新しい順。先頭から)と、いろいろな切り口 */
export type AutoAlbumsResponse = {
  /** できごとの、全部の件数 */
  eventTotal: number;
  events: AutoEvent[];
  albums: AutoAlbum[];
  /** 日付が不明なものの、区分ごとの枚数 */
  dateGaps: DateGap[];
};

/** 地図: 表示範囲のまとまり(クラスタ)と、GPS のある・ない枚数 */
export type MapClustersResponse = {
  clusters: MapCluster[];
  /** 条件・表示範囲に合う、GPS のある写真の枚数 */
  total: number;
  /** 全体の、GPS のある・ない枚数(絞り込みの条件は、効かない) */
  withGps: number;
  withoutGps: number;
};

/** 場所の検索の結果(地名・都道府県・国)。`bounds` へ、地図を動かす。`count` は、その地域の写真の枚数(0 でも、動かせる) */
export type MapPlacesResponse = {
  places: {
    ref: string;
    label: string;
    bounds: { south: number; west: number; north: number; east: number };
    count: number;
  }[];
};

/** 背景地図(オンラインの地図タイル)の設定 */
export type MapConfigResponse = {
  /** タイルの URL(`{z}`・`{x}`・`{y}`) */
  tileUrl: string;
  /** 出典の表記(画面に出す) */
  attribution: string;
  /** 画面に出す、背景の名前 */
  label: string;
  maxZoom: number;
};
