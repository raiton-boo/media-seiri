import type { Database } from 'bun:sqlite';
import {
  type ComputedEvent,
  computeAlbumEvents,
  type EventFile,
} from '@file-seiri/core';
import {
  type AlbumEventInput,
  listFilesForEvents,
  replaceAlbumEvents,
} from '@file-seiri/ledger';

export type RebuildResult = {
  /** 計算の対象にしたファイルの数 */
  files: number;
  /** できたできごとの数 */
  events: number;
};

const toInput = (event: ComputedEvent): AlbumEventInput => ({
  startAt: event.startAt,
  endAt: event.endAt,
  rule: event.rule,
  ...(event.centroid
    ? { centroidLat: event.centroid.lat, centroidLon: event.centroid.lon }
    : {}),
  coverLibraryFileId: event.coverId,
  libraryFileIds: event.fileIds,
});

/**
 * できごとを、全体、計算し直して、台帳に保存する(仕様書 §16-6)。
 * ライブラリのファイルのうち、日付の精度が `full` / `date` のものが、対象。台帳の書き込みのトランザクションの中で呼ぶ。
 * `revision` は、この計算を含む、台帳のリビジョン(`album_events.computed_revision` に残す)。
 */
export const rebuildAlbumEvents = (
  db: Database,
  revision: number
): RebuildResult => {
  const rows = listFilesForEvents(db);
  const files: EventFile[] = rows.map((row) => ({
    id: row.libraryFileId,
    takenAt: row.takenAt,
    precision: row.precision,
    ...(row.lat !== null && row.lon !== null
      ? { lat: row.lat, lon: row.lon }
      : {}),
  }));
  const events = computeAlbumEvents(files);
  replaceAlbumEvents(db, events.map(toInput), revision);
  return { files: files.length, events: events.length };
};
