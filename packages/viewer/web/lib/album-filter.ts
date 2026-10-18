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
};

export const EMPTY_FILTER: FilterState = {
  kinds: [],
  cameras: [],
  years: [],
  precisions: [],
  sources: [],
  volumes: [],
};

/** 複数の値をとる項目と、URL のクエリでの名前 */
export const LIST_KEYS = {
  kinds: 'kind',
  cameras: 'camera',
  years: 'year',
  precisions: 'precision',
  sources: 'source',
  volumes: 'volume',
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
});

/** 有効な条件の数(複数の値を選んでいても、項目で 1 件) */
export const countFilter = (filter: FilterState): number =>
  [
    filter.kinds.length,
    filter.cameras.length,
    filter.gps ? 1 : 0,
    filter.years.length,
    filter.precisions.length,
    filter.sources.length,
    filter.volumes.length,
  ].filter(Boolean).length;

/** 一覧に、値があれば外し、なければ足す(順は、保つ) */
export const toggleValue = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
