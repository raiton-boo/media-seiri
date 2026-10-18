import { queryString } from './api';

export type AlbumLocation = {
  /** 省くと、入口(最新の年の机) */
  view?: 'year' | 'month' | 'event';
  y?: number;
  m?: number;
  /** できごとの ID */
  e?: number;
  /** 並び順。`new`(既定)は、URL に出さない */
  order?: 'new' | 'old';
  /** 月の机で、小さなできごとも出す */
  small?: boolean;
  /** できごとの机で、広げた写真の数(既定は、12 枚) */
  more?: number;
};

/** アルバムの URL。年・月・できごとは、クエリ文字列で表す(静的書き出しのため。tech-selection §3-1) */
export const albumHref = (location: AlbumLocation = {}): string =>
  `/album${queryString({
    view: location.view,
    y: location.y,
    m: location.m,
    e: location.e,
    order: location.order === 'old' ? 'old' : undefined,
    small: location.small ? 1 : undefined,
    more: location.more,
  })}`;
