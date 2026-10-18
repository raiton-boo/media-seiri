import type { Database } from 'bun:sqlite';
import {
  type AlbumFilter,
  albumFilterSql,
  UNKNOWN_CAMERA,
} from './album-filter.ts';
import { listSourceVolumes } from './fallback-browse.ts';

export type FacetValue<T> = { value: T; count: number };

/** 絞り込みの引き出しの、選択肢と件数 */
export type FilterOptions = {
  kinds: FacetValue<'photo' | 'video' | 'raw'>[];
  cameras: FacetValue<string>[];
  gps: { with: number; without: number };
  years: FacetValue<number>[];
  precisions: FacetValue<string>[];
  dateSources: FacetValue<string>[];
  volumes: { volumeId: number; label: string | null; count: number }[];
};

const FILES = `FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id`;

type Param = string | number;

/**
 * 選択肢ごとの件数。**その項目自身の条件は外して**数える(ほかの条件には、従う)。
 * こうしておくと、「写真」を選んだあとも、「動画」の件数が見え、チェックを足して広げられる。
 */
export const listFilterOptions = (
  db: Database,
  filter: AlbumFilter
): FilterOptions => {
  const without = (key: keyof AlbumFilter): AlbumFilter => {
    const copy = { ...filter };
    delete copy[key];
    return copy;
  };
  const count = (narrow: AlbumFilter, extra = ''): number => {
    const { sql, params } = albumFilterSql(narrow);
    return (
      db
        .query<{ n: number }, Param[]>(
          `SELECT count(*) AS n ${FILES} WHERE 1 = 1${extra}${sql}`
        )
        .get(...params)?.n ?? 0
    );
  };
  const grouped = <T extends Param>(
    key: keyof AlbumFilter,
    expression: string,
    order: string
  ): FacetValue<T>[] => {
    const { sql, params } = albumFilterSql(without(key));
    return db
      .query<{ value: T; count: number }, Param[]>(
        `SELECT ${expression} AS value, count(*) AS count ${FILES}
         WHERE 1 = 1${sql} GROUP BY value ORDER BY ${order}`
      )
      .all(...params);
  };

  const kinds = (['photo', 'video', 'raw'] as const).map((kind) => ({
    value: kind,
    count: count({ ...without('kinds'), kinds: [kind] }),
  }));
  const withoutGps = without('gps');
  return {
    kinds,
    cameras: grouped<string>(
      'cameras',
      `coalesce(m.camera_model, '${UNKNOWN_CAMERA}')`,
      `(value = '${UNKNOWN_CAMERA}'), count DESC, value`
    ),
    gps: {
      with: count({ ...withoutGps, gps: true }),
      without: count({ ...withoutGps, gps: false }),
    },
    years: db
      .query<{ value: number; count: number }, Param[]>(
        `SELECT CAST(substr(m.taken_at, 1, 4) AS INTEGER) AS value, count(*) AS count ${FILES}
         WHERE m.taken_at IS NOT NULL${albumFilterSql(without('years')).sql}
         GROUP BY value ORDER BY value DESC`
      )
      .all(...albumFilterSql(without('years')).params),
    precisions: grouped<string>(
      'precisions',
      'm.date_precision',
      'count DESC, value'
    ),
    dateSources: grouped<string>(
      'dateSources',
      'm.date_source',
      'count DESC, value'
    ),
    volumes: listSourceVolumes(db).map((volume) => ({
      ...volume,
      count: count({ ...without('volumeIds'), volumeIds: [volume.volumeId] }),
    })),
  };
};
