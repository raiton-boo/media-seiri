import type { Database } from 'bun:sqlite';
import { type AlbumFilter, albumFilterSql } from './album-filter.ts';

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

type Param = string | number;

/** 地図のまとまり(クラスタ): 近い位置の写真を、格子で束ねたもの。1 枚なら、そのままピン */
export type MapCluster = {
  /** 平均の位置(まとまりの印を置く場所) */
  lat: number;
  lon: number;
  count: number;
  /** まとまりの範囲(押したとき、ここへ拡大する。写真の一覧の範囲にもなる) */
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  /** 代表の 1 枚(サムネイルのあるもののうち、`library_file_id` が最小。なければ、最小) */
  libraryFileId: number;
};

/** 一度に返す、まとまりの数の上限(表示の重さの、安全のため) */
export const MAX_MAP_CLUSTERS = 2000;

/**
 * 表示範囲の、地図のまとまり。`cellDegrees` の格子ごとに束ねる(ズームが上がるほど、細かく)。
 * GPS が(0, 0)のものは、無効として、除く。絞り込み・検索の条件が効く。
 */
export const listMapClusters = (
  db: Database,
  filter: AlbumFilter,
  cellDegrees: number
): { clusters: MapCluster[]; total: number } => {
  const { sql, params } = albumFilterSql(filter);
  const where = `m.gps_lat IS NOT NULL AND m.gps_lon IS NOT NULL
    AND NOT (m.gps_lat = 0 AND m.gps_lon = 0)${sql}`;
  const clusters = db
    .query<MapCluster, Param[]>(
      // 緯度・経度を、負にならないようにずらして、切り捨て(整数にする)= 格子の番号
      `SELECT avg(m.gps_lat) AS lat, avg(m.gps_lon) AS lon, count(*) AS count,
              min(m.gps_lat) AS minLat, max(m.gps_lat) AS maxLat,
              min(m.gps_lon) AS minLon, max(m.gps_lon) AS maxLon,
              coalesce(min(CASE WHEN f.thumb_rel_path IS NOT NULL THEN f.library_file_id END), min(f.library_file_id)) AS libraryFileId
       ${FILES} WHERE ${where}
       GROUP BY CAST((m.gps_lat + 90) / ? AS INTEGER), CAST((m.gps_lon + 180) / ? AS INTEGER)
       ORDER BY count DESC LIMIT ?`
    )
    .all(...params, cellDegrees, cellDegrees, MAX_MAP_CLUSTERS);
  const total =
    db
      .query<{ n: number }, Param[]>(
        `SELECT count(*) AS n ${FILES} WHERE ${where}`
      )
      .get(...params)?.n ?? 0;
  return { clusters, total };
};

/** 地図にピンを出せる(GPS が有効な)写真の枚数と、GPS のない写真の枚数(絞り込みの条件は、効かない) */
export const countMapPhotos = (
  db: Database
): { withGps: number; withoutGps: number } => {
  const row = db
    .query<{ withGps: number | null; withoutGps: number | null }, []>(
      `SELECT sum(m.gps_lat IS NOT NULL AND m.gps_lon IS NOT NULL AND NOT (m.gps_lat = 0 AND m.gps_lon = 0)) AS withGps,
              sum(m.gps_lat IS NULL OR m.gps_lon IS NULL OR (m.gps_lat = 0 AND m.gps_lon = 0)) AS withoutGps
       ${FILES}`
    )
    .get();
  return { withGps: row?.withGps ?? 0, withoutGps: row?.withoutGps ?? 0 };
};
