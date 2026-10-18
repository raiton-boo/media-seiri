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
  /** ライブフォト: 同名グループに、写真と動画の両方があるもの(その写真も動画も) */
  livePhotos?: boolean;
  /** できごと(拡大表示で、できごとの中を、前後に動くときの範囲) */
  eventId?: number;
  /** 検索: 日付(`YYYY` / `YYYY-MM` / `YYYY-MM-DD`)。撮影日時が、その日付で始まるもの。複数なら、どれか */
  dates?: string[];
  /** 検索: ファイル名に含む文字(大文字・小文字は、区別しない)。複数なら、どれか */
  names?: string[];
  /** 検索: 場所(GPS を 0.1 度(約 11km)の格子にまとめた、中心)。複数なら、どれか */
  places?: { lat: number; lon: number }[];
};

/** どの写真にも合わない場所(「地名に合う写真が、1 枚もない」を、条件で表すとき。条件の配列が空だと、絞らないことになるため) */
export const NO_PLACE = { lat: 999, lon: 999 } as const;

/** 場所の格子(度)。地名への変換はしないので、座標のまとまりで探す */
export const PLACE_CELL_DEGREES = 0.1;

/** 座標を、格子の中心に丸める(SQL の `round(x, 1)` と、同じ丸め) */
export const roundToPlaceCell = (value: number): number =>
  Math.round(value / PLACE_CELL_DEGREES) / (1 / PLACE_CELL_DEGREES);

/** LIKE の特別な文字(`%`・`_`・`\`)を、そのままの文字として扱う */
export const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** ファイル名(`rel_path` の、最後の `/` のあと)を取り出す SQL */
const BASENAME_SQL = `replace(f.rel_path, rtrim(f.rel_path, replace(f.rel_path, '/', '')), '')`;

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
  if (filter.dates && filter.dates.length > 0) {
    parts.push(
      `(${filter.dates.map(() => "m.taken_at LIKE ? || '%'").join(' OR ')})`
    );
    params.push(...filter.dates);
  }
  if (filter.names && filter.names.length > 0) {
    parts.push(
      `(${filter.names.map(() => `lower(${BASENAME_SQL}) LIKE '%' || lower(?) || '%' ESCAPE '\\'`).join(' OR ')})`
    );
    params.push(...filter.names.map(escapeLike));
  }
  if (filter.places && filter.places.length > 0) {
    parts.push(
      `(${filter.places
        .map(() => '(round(m.gps_lat, 1) = ? AND round(m.gps_lon, 1) = ?)')
        .join(' OR ')})`
    );
    for (const place of filter.places) params.push(place.lat, place.lon);
  }
  if (filter.livePhotos) {
    const likes = (kind: 'photo' | 'video'): string =>
      EXTENSIONS_BY_KIND[kind]
        .map(() => "lower(g.rel_path) LIKE ? ESCAPE '\\'")
        .join(' OR ');
    parts.push(
      `f.group_id IN (
         SELECT g.group_id FROM library_files AS g WHERE ${likes('photo')}
         INTERSECT
         SELECT g.group_id FROM library_files AS g WHERE ${likes('video')})`
    );
    for (const kind of ['photo', 'video'] as const)
      for (const extension of EXTENSIONS_BY_KIND[kind])
        params.push(`%.${extension}`);
  }
  if (filter.eventId !== undefined) {
    parts.push('f.album_event_id = ?');
    params.push(filter.eventId);
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
    filter.livePhotos ? 1 : 0,
    filter.dates?.length,
    filter.names?.length,
    filter.places?.length,
  ].filter(Boolean).length;
