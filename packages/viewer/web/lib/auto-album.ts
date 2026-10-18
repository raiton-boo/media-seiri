import type { AutoAlbum } from '@file-seiri/ledger';
import { EMPTY_FILTER, type FilterState } from './album-filter';

/** 自動アルバムの中身を決める条件を、画面の絞り込みの条件にする(押すと、この条件の「すべて」を開く) */
export const filterOfAutoAlbum = (album: AutoAlbum): FilterState => {
  const { filter } = album;
  return {
    ...EMPTY_FILTER,
    kinds: filter.kinds ?? [],
    cameras: filter.cameras ?? [],
    gps: filter.gps === true ? '1' : undefined,
    precisions: filter.precisions ?? [],
    sources: filter.dateSources ?? [],
    live: filter.livePhotos ? '1' : undefined,
  };
};

/** 切り口の札(ワイヤーフレームの、左上の印)の、文字と色 */
export const AUTO_ALBUM_BADGES: Record<
  AutoAlbum['kind'],
  { label: string; tone: string }
> = {
  video: { label: '▶ 動画', tone: 'o' },
  raw: { label: 'RAW', tone: 'l' },
  live: { label: 'PAIR', tone: '' },
  gps: { label: '⌖ GPS', tone: 'g' },
  camera: { label: '◎ カメラ', tone: '' },
  fallback: { label: '日付', tone: 'y' },
  undated: { label: '不明', tone: 'r' },
};
