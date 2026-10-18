import type { Database } from 'bun:sqlite';

export type AlbumEvent = {
  albumEventId: number;
  /** `formatTakenAt` の形式(精度が `date` のできごとは、日付だけ) */
  startAt: string;
  endAt: string;
  fileCount: number;
  centroidLat: number | null;
  centroidLon: number | null;
  /** 代表の写真 */
  coverLibraryFileId: number | null;
  /** できごとを区切った規則(`4h` / `5km` など) */
  rule: string;
  /** 計算したときの、台帳のリビジョン */
  computedRevision: number;
};

/** 計算したできごと。件数は、`libraryFileIds` の数から決める */
export type AlbumEventInput = {
  startAt: string;
  endAt: string;
  rule: string;
  centroidLat?: number;
  centroidLon?: number;
  /** 代表の写真。`libraryFileIds` の中から選ぶ */
  coverLibraryFileId?: number;
  /** このできごとに属する写真。1 つ以上。ほかのできごととは、重ならない */
  libraryFileIds: readonly number[];
};

const COLUMNS = `album_event_id AS albumEventId, start_at AS startAt, end_at AS endAt,
  file_count AS fileCount, centroid_lat AS centroidLat, centroid_lon AS centroidLon,
  cover_library_file_id AS coverLibraryFileId, rule, computed_revision AS computedRevision`;

const validate = (events: readonly AlbumEventInput[]): void => {
  const seen = new Set<number>();
  for (const event of events) {
    if (event.libraryFileIds.length === 0) {
      throw new RangeError('できごとに、写真が 1 枚もありません');
    }
    if (
      event.coverLibraryFileId !== undefined &&
      !event.libraryFileIds.includes(event.coverLibraryFileId)
    ) {
      throw new RangeError(
        `代表の写真(${event.coverLibraryFileId})が、できごとの写真にありません`
      );
    }
    for (const id of event.libraryFileIds) {
      // 1 枚の写真は、高々 1 つのできごとに属する(`er.md` §3-6)
      if (seen.has(id)) {
        throw new RangeError(`写真(${id})が、複数のできごとにあります`);
      }
      seen.add(id);
    }
  }
};

/**
 * できごとを、全体、入れ替える(取り込みの最後に、計算し直して保存する。仕様書 §16-6)。
 * 前のできごとは、すべて消し、写真の所属も、いったん外してから、結び直す(1 つのトランザクションで)。
 * 渡さなかった写真は、できごとに属さない(精度が低いもの)。ない写真を指すと、エラーで、すべて取り消す。
 */
export const replaceAlbumEvents = (
  db: Database,
  events: readonly AlbumEventInput[],
  computedRevision: number
): number[] => {
  validate(events);
  return db.transaction((): number[] => {
    // library_files.album_event_id は、できごとを消すと、NULL に戻る(ON DELETE SET NULL)
    db.query('DELETE FROM album_events').run();
    const insert = db.query(
      `INSERT INTO album_events
         (start_at, end_at, file_count, centroid_lat, centroid_lon, cover_library_file_id, rule, computed_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const assign = db.query(
      'UPDATE library_files SET album_event_id = ? WHERE library_file_id = ?'
    );
    return events.map((event) => {
      const albumEventId = Number(
        insert.run(
          event.startAt,
          event.endAt,
          event.libraryFileIds.length,
          event.centroidLat ?? null,
          event.centroidLon ?? null,
          event.coverLibraryFileId ?? null,
          event.rule,
          computedRevision
        ).lastInsertRowid
      );
      for (const libraryFileId of event.libraryFileIds) {
        if (assign.run(albumEventId, libraryFileId).changes === 0) {
          throw new RangeError(`写真(${libraryFileId})がありません`);
        }
      }
      return albumEventId;
    });
  })();
};

export const getAlbumEvent = (
  db: Database,
  albumEventId: number
): AlbumEvent | undefined =>
  db
    .query<AlbumEvent, [number]>(
      `SELECT ${COLUMNS} FROM album_events WHERE album_event_id = ?`
    )
    .get(albumEventId) ?? undefined;

/** できごとの一覧。新しい順(開始の時刻の降順) */
export const listAlbumEvents = (
  db: Database,
  options: { limit?: number; offset?: number } = {}
): AlbumEvent[] =>
  db
    .query<AlbumEvent, [number, number]>(
      `SELECT ${COLUMNS} FROM album_events
       ORDER BY start_at DESC, album_event_id DESC LIMIT ? OFFSET ?`
    )
    // SQLite では、LIMIT が負なら、無制限
    .all(options.limit ?? -1, options.offset ?? 0);

export const countAlbumEvents = (db: Database): number =>
  db
    .query<{ count: number }, []>('SELECT count(*) AS count FROM album_events')
    .get()?.count ?? 0;

/** できごとの計算に使う、ライブラリのファイル(日付の精度が `full` / `date` で、撮影日時があるもの) */
export type EventSourceRow = {
  libraryFileId: number;
  /** `formatTakenAt` の形式(精度 `date` は、日付だけ) */
  takenAt: string;
  precision: 'full' | 'date';
  lat: number | null;
  lon: number | null;
};

/** ライブラリのファイルすべてのうち、できごとにできるもの(登録の順)。サイドカーなど、メタデータのないものは、含まない */
export const listFilesForEvents = (db: Database): EventSourceRow[] =>
  db
    .query<EventSourceRow, []>(
      `SELECT f.library_file_id AS libraryFileId, m.taken_at AS takenAt, m.date_precision AS precision,
              m.gps_lat AS lat, m.gps_lon AS lon
       FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE m.date_precision IN ('full', 'date') AND m.taken_at IS NOT NULL
       ORDER BY f.library_file_id`
    )
    .all();
