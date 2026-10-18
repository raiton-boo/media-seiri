/** 拡大表示の、決まり(ブラウザで表示できる形・日付の見せ方) */
import { parseTakenAt, weekdayOf } from './album';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm'];

/** ブラウザが、そのまま表示できる形か(サーバーの `DISPLAYABLE` と、同じ一覧)。HEIC・RAW などは、null(サムネイルを見せる) */
export const viewKindOf = (relPath: string): 'image' | 'video' | null => {
  const extension = relPath.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  return null;
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** 撮影日時の見出し(`2014年4月6日(日)15:32`)。時刻がなければ日付まで、月・年だけなら、そこまで。なければ「日付なし」 */
export const formatPhotoDate = (takenAt: string | null): string => {
  if (!takenAt) return '日付なし';
  const parts = parseTakenAt(takenAt);
  if (!parts) return takenAt;
  // `2024-08`・`2020`(精度が、月・年)は、日が読めないので、そのままの文字で見せる
  const clock =
    parts.hour !== undefined && parts.minute !== undefined
      ? ` ${pad(parts.hour)}:${pad(parts.minute)}`
      : '';
  return `${parts.year}年${parts.month}月${parts.day}日(${weekdayOf(parts.year, parts.month, parts.day)})${clock}`;
};

/** 座標を、検索の場所の格子(0.1 度)にする */
export const placeCell = (value: number): number => Math.round(value * 10) / 10;
