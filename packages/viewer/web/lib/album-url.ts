import { type FilterState, filterParams } from './album-filter';
import { queryString } from './api';

export type AlbumLocation = {
  /** 省くと、入口(最新の年の机) */
  view?: 'year' | 'month' | 'event' | 'all' | 'search' | 'photo';
  y?: number;
  m?: number;
  /** できごとの ID(拡大表示では、前後に動く範囲) */
  e?: number;
  /** 拡大表示する写真(`library_file_id`) */
  p?: number;
  /** 並び順。`new`(既定)は、URL に出さない */
  order?: 'new' | 'old';
  /** 「すべて」の配置。`masonry`(既定)は、URL に出さない */
  layout?: 'masonry' | 'rows';
  /** 絞り込みの条件(移っても、引き継ぐ)。省くと、条件なし */
  filter?: FilterState;
  /** 絞り込みの引き出しを開く */
  drawer?: boolean;
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
    p: location.p,
    order: location.order === 'old' ? 'old' : undefined,
    layout: location.layout === 'rows' ? 'rows' : undefined,
    ...(location.filter ? filterParams(location.filter) : {}),
    drawer: location.drawer ? 1 : undefined,
    small: location.small ? 1 : undefined,
    more: location.more,
  })}`;
