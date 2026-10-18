import { EXTENSIONS_BY_KIND } from '@file-seiri/core';

/** アルバムの絞り込み(仕様書: album.md §8)。条件を指定しなければ、その条件では、絞らない。複数の条件は、すべてを満たすもの(AND) */
export type AlbumFilter = {
  /** 種別(写真・動画・RAW)。複数なら、どれか */
  kinds?: ('photo' | 'video' | 'raw')[];
  /** カメラの機種。`'不明'` は、メタデータがないもの。複数なら、どれか */
  cameras?: string[];
  /** GPS: true=あり、false=なし */
  gps?: boolean;
  years?: number[];
  /** 日付の精度(`full` / `date` / `month` / `year` / `none` / `invalid`) */
  precisions?: string[];
  /** 日付の取得元(`exif` / `video` / `json` / `filename` / `none`) */
  dateSources?: string[];
  /** ソースのドライブ(コピーしたソースのファイルの、ドライブ) */
  volumeIds?: number[];
};

/** カメラの「不明」を表す名前 */
export const UNKNOWN_CAMERA = '不明';

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(', ');

/**
 * 絞り込みの SQL の断片(`AND ...` をつなげたもの)と、値。
 * `f` が `library_files`、`m` が `media_metadata` の別名であることを、前提にする。条件がなければ、空の文字列。
 */
export const albumFilterSql = (
  filter: AlbumFilter
): { sql: string; params: (string | number)[] } => {
  const parts: string[] = [];
  const params: (string | number)[] = [];

  if (filter.kinds && filter.kinds.length > 0) {
    const likes: string[] = [];
    for (const kind of filter.kinds) {
      for (const extension of EXTENSIONS_BY_KIND[kind]) {
        likes.push("lower(f.rel_path) LIKE ? ESCAPE '\\'");
        params.push(`%.${extension}`);
      }
    }
    parts.push(`(${likes.join(' OR ')})`);
  }
  if (filter.cameras && filter.cameras.length > 0) {
    const named = filter.cameras.filter((camera) => camera !== UNKNOWN_CAMERA);
    const clauses: string[] = [];
    if (named.length > 0) {
      clauses.push(`m.camera_model IN (${placeholders(named.length)})`);
      params.push(...named);
    }
    if (filter.cameras.includes(UNKNOWN_CAMERA)) {
      clauses.push('m.camera_model IS NULL');
    }
    parts.push(`(${clauses.join(' OR ')})`);
  }
  if (filter.gps !== undefined) {
    parts.push(filter.gps ? 'm.gps_lat IS NOT NULL' : 'm.gps_lat IS NULL');
  }
  if (filter.years && filter.years.length > 0) {
    parts.push(
      `(m.taken_at IS NOT NULL AND CAST(substr(m.taken_at, 1, 4) AS INTEGER) IN (${placeholders(filter.years.length)}))`
    );
    params.push(...filter.years);
  }
  if (filter.precisions && filter.precisions.length > 0) {
    parts.push(
      `m.date_precision IN (${placeholders(filter.precisions.length)})`
    );
    params.push(...filter.precisions);
  }
  if (filter.dateSources && filter.dateSources.length > 0) {
    parts.push(`m.date_source IN (${placeholders(filter.dateSources.length)})`);
    params.push(...filter.dateSources);
  }
  if (filter.volumeIds && filter.volumeIds.length > 0) {
    parts.push(
      `EXISTS (SELECT 1 FROM source_files AS sf WHERE sf.content_id = f.content_id AND sf.state = 'done'
         AND sf.volume_id IN (${placeholders(filter.volumeIds.length)}))`
    );
    params.push(...filter.volumeIds);
  }
  return {
    sql: parts.map((part) => ` AND ${part}`).join(''),
    params,
  };
};

/** 有効な条件の数(札の「3 件の条件」に使う) */
export const countAlbumFilters = (filter: AlbumFilter): number =>
  [
    filter.kinds?.length,
    filter.cameras?.length,
    filter.gps === undefined ? 0 : 1,
    filter.years?.length,
    filter.precisions?.length,
    filter.dateSources?.length,
    filter.volumeIds?.length,
  ].filter(Boolean).length;
