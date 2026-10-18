/** 絞り込みの条件(画面側)。URL のクエリで持ち、API にも、そのまま渡す(`parseAlbumFilter` と、同じ名前) */
export type FilterState = {
  kinds: string[];
  cameras: string[];
  /** '1' = あり、'0' = なし */
  gps?: '1' | '0';
  years: string[];
  precisions: string[];
  sources: string[];
  volumes: string[];
  /** 地図の範囲(`南,西,北,東`の度)。範囲の中に GPS のある写真 */
  bbox?: string;
  /** 期間(`YYYY-MM-DD`。両端を含む)。日まで分かる写真だけが、対象 */
  from?: string;
  to?: string;
  /** ライブフォト(同名グループに、写真と動画がある組)。'1' = 絞る */
  live?: '1';
  /** 検索の条件。日付(`YYYY-MM-DD` など)・ファイル名の一部・場所(`緯度:経度`) */
  dates: string[];
  names: string[];
  places: string[];
  /** 地域(地名・都道府県・国)の指定。`city:<ID>`・`pref:<2 桁>`・`country:<国コード>` */
  areas: string[];
};

export const EMPTY_FILTER: FilterState = {
  kinds: [],
  cameras: [],
  years: [],
  precisions: [],
  sources: [],
  volumes: [],
  dates: [],
  names: [],
  places: [],
  areas: [],
};

/** 複数の値をとる項目と、URL のクエリでの名前 */
export const LIST_KEYS = {
  kinds: 'kind',
  cameras: 'camera',
  years: 'year',
  precisions: 'precision',
  sources: 'source',
  volumes: 'volume',
  dates: 'date',
  names: 'name',
  places: 'place',
  areas: 'area',
} as const satisfies Record<string, string>;

export type ListField = keyof typeof LIST_KEYS;

/** URL から、条件を読む。値は、`getAll` で、同じ名前の分を、全部取る */
export const readFilter = (getAll: (key: string) => string[]): FilterState => {
  const gps = getAll('gps')[0];
  return {
    kinds: getAll(LIST_KEYS.kinds),
    cameras: getAll(LIST_KEYS.cameras),
    gps: gps === '1' || gps === '0' ? gps : undefined,
    years: getAll(LIST_KEYS.years),
    precisions: getAll(LIST_KEYS.precisions),
    sources: getAll(LIST_KEYS.sources),
    volumes: getAll(LIST_KEYS.volumes),
    dates: getAll(LIST_KEYS.dates),
    names: getAll(LIST_KEYS.names),
    places: getAll(LIST_KEYS.places),
    areas: getAll(LIST_KEYS.areas),
    live: getAll('live')[0] === '1' ? '1' : undefined,
    bbox: getAll('bbox')[0] || undefined,
    from: getAll('from')[0] || undefined,
    to: getAll('to')[0] || undefined,
  };
};

/** 条件を、クエリの項目にする(API にも、画面の URL にも使う)。空の項目は、出さない */
export const filterParams = (
  filter: FilterState
): Record<string, string[] | string | undefined> => ({
  [LIST_KEYS.kinds]: filter.kinds,
  [LIST_KEYS.cameras]: filter.cameras,
  gps: filter.gps,
  [LIST_KEYS.years]: filter.years,
  [LIST_KEYS.precisions]: filter.precisions,
  [LIST_KEYS.sources]: filter.sources,
  [LIST_KEYS.volumes]: filter.volumes,
  [LIST_KEYS.dates]: filter.dates,
  [LIST_KEYS.names]: filter.names,
  [LIST_KEYS.places]: filter.places,
  [LIST_KEYS.areas]: filter.areas,
  live: filter.live,
  bbox: filter.bbox,
  from: filter.from,
  to: filter.to,
});

/** 絞り込み(引き出しの項目)の条件の数。複数の値を選んでいても、項目で 1 件。検索の条件は、数えない */
export const countFilter = (filter: FilterState): number =>
  [
    filter.kinds.length,
    filter.cameras.length,
    filter.gps ? 1 : 0,
    filter.years.length,
    filter.precisions.length,
    filter.sources.length,
    filter.volumes.length,
    filter.live ? 1 : 0,
    filter.bbox ? 1 : 0,
    filter.from || filter.to ? 1 : 0,
  ].filter(Boolean).length;

/** 一覧に、値があれば外し、なければ足す(順は、保つ) */
export const toggleValue = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/** 検索の条件の数(札になるもの。1 つずつ数える) */
export const countSearch = (filter: FilterState): number =>
  filter.dates.length +
  filter.names.length +
  filter.places.length +
  filter.areas.length;

/** 絞り込みか検索の、どれかの条件が、あるか */
export const isFiltered = (filter: FilterState): boolean =>
  countFilter(filter) + countSearch(filter) > 0;

/**
 * 条件を 1 つ外す(いちばん後ろの条件から)。「条件を 1 つずつ外す」で、結果が出るところまで戻るために使う。
 * 順序: 絞り込み(種別・カメラ・GPS・年・精度・取得元・ソース・ライブフォト)のあとに、検索(日付・名前・場所・地域)。
 * 複数の値を持つ項目は、後ろの値から 1 つずつ。条件がなければ、そのまま。
 */
export const removeLastCondition = (filter: FilterState): FilterState => {
  const lists = [
    'kinds',
    'cameras',
    'years',
    'precisions',
    'sources',
    'volumes',
    'dates',
    'names',
    'places',
    'areas',
  ] as const;
  // 後ろにあるものから探す(gps・live は、絞り込みの並びの途中・最後に入る)
  const order: (ListField | 'gps' | 'live' | 'bbox' | 'period')[] = [
    'kinds',
    'cameras',
    'gps',
    'years',
    'precisions',
    'sources',
    'volumes',
    'live',
    'bbox',
    'period',
    'dates',
    'names',
    'places',
    'areas',
  ];
  for (const key of [...order].reverse()) {
    if (key === 'period') {
      if (filter.from || filter.to)
        return { ...filter, from: undefined, to: undefined };
    } else if (key === 'gps' || key === 'live' || key === 'bbox') {
      if (filter[key]) return { ...filter, [key]: undefined };
    } else if (
      (lists as readonly string[]).includes(key) &&
      filter[key].length > 0
    ) {
      return { ...filter, [key]: filter[key].slice(0, -1) };
    }
  }
  return filter;
};
