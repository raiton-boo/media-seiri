'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { EMPTY_FILTER, type FilterState } from './album-filter';
import { type AlbumLocation, albumHref } from './album-url';

type Value = { filter: FilterState; drawer: boolean };

const AlbumFilterContext = createContext<Value>({
  filter: EMPTY_FILTER,
  drawer: false,
});

/** アルバムの中の移動で、絞り込みの条件と、引き出しの開閉を引き継ぐための入れ物 */
export function AlbumFilterProvider({
  filter,
  drawer,
  children,
}: Value & { children: ReactNode }) {
  const value = useMemo(() => ({ filter, drawer }), [filter, drawer]);
  return (
    <AlbumFilterContext.Provider value={value}>
      {children}
    </AlbumFilterContext.Provider>
  );
}

/** 条件を引き継ぐ `albumHref`。移った先でも、同じ条件で絞られる */
export const useAlbumHref = (): ((location?: AlbumLocation) => string) => {
  const { filter, drawer } = useContext(AlbumFilterContext);
  return useCallback(
    (location = {}) => albumHref({ filter, drawer, ...location }),
    [filter, drawer]
  );
};
