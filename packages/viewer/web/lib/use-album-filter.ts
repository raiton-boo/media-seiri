'use client';

import {
  countSearch,
  type FilterState,
  filterParams,
  readFilter,
} from './album-filter';
import { type AlbumLocation, albumHref as buildHref } from './album-url';
import { useAlbumFilters } from './api';
import { useUrlState } from './query-state';

/**
 * アルバムの画面に共通の、絞り込み・検索の状態(URL から読む)と、その操作。
 * 条件を変えても、画面(`view`)・年などは、そのまま。検索の札の決定は、検索結果の画面へ移る。
 */
export const useAlbumFilterState = () => {
  const url = useUrlState();
  const filter = readFilter(url.getAll);
  const drawer = url.get('drawer') === '1';
  // 移っても、条件と引き出しの開閉を引き継ぐ
  const albumHref = (location: AlbumLocation = {}): string =>
    buildHref({ filter, drawer, ...location });
  const facets = useAlbumFilters(filter, drawer || filter.volumes.length > 0);
  const volumeLabels = new Map(
    (facets.data?.volumes ?? []).map((volume) => [
      String(volume.volumeId),
      volume.label ?? `ドライブ #${volume.volumeId}`,
    ])
  );
  return {
    url,
    filter,
    drawer,
    albumHref,
    volumeLabels,
    toggleDrawer: (): void => url.set({ drawer: drawer ? undefined : '1' }),
    changeFilter: (next: FilterState): void =>
      url.set({ ...filterParams(next), more: undefined }),
    /** 検索の候補を決めた: 検索結果の画面へ */
    pickSearch: (next: FilterState): void =>
      url.set({
        ...filterParams(next),
        view: 'search',
        y: undefined,
        m: undefined,
        e: undefined,
        d: undefined,
        more: undefined,
        small: undefined,
      }),
    /** 検索の札を外した(いまの画面に、とどまる) */
    removeSearch: (next: FilterState): void =>
      url.set({ ...filterParams(next), more: undefined }),
    hasSearch: countSearch(filter) > 0,
  };
};
