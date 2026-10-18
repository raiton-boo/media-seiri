import { describe, expect, test } from 'bun:test';
import { listFilesForEvents } from './album-events.ts';
import { getOrCreateContent } from './contents.ts';
import { insertFileGroup } from './file-groups.ts';
import { openDb, seedRun, T0 } from './fixtures.ts';
import { insertLibraryFile } from './library-files.ts';

describe('listFilesForEvents', () => {
  test('精度が full / date で、撮影日時があるものだけを、登録の順に返す。GPS も添える', () => {
    const db = openDb();
    const seed = seedRun(db);
    let n = 0;
    const add = (
      relPath: string,
      metadata: [string | null, string, number | null, number | null] | null
    ) => {
      n += 1;
      const { content } = getOrCreateContent(db, {
        hash: String(n).padStart(64, 'e'),
        sizeBytes: 1,
      });
      if (metadata) {
        db.query(
          `INSERT INTO media_metadata (content_id, taken_at, date_precision, date_source, gps_lat, gps_lon)
           VALUES (?, ?, ?, 'exif', ?, ?)`
        ).run(
          content.contentId,
          metadata[0],
          metadata[1],
          metadata[2],
          metadata[3]
        );
      }
      return insertLibraryFile(db, {
        contentId: content.contentId,
        groupId: insertFileGroup(db, { stem: relPath, bucket: 'full' }),
        runId: seed.runId,
        relPath,
        bucket: 'full',
        createdAt: T0,
      });
    };
    const a = add('a.jpg', ['2024-03-05T10:00:00', 'full', 35, 139]);
    add('month.jpg', ['2024-03', 'month', null, null]);
    add('none.jpg', [null, 'none', null, null]);
    add('sidecar.xmp', null);
    const b = add('b.jpg', ['2024-03-06', 'date', null, null]);
    expect(listFilesForEvents(db)).toEqual([
      {
        libraryFileId: a,
        takenAt: '2024-03-05T10:00:00',
        precision: 'full',
        lat: 35,
        lon: 139,
      },
      {
        libraryFileId: b,
        takenAt: '2024-03-06',
        precision: 'date',
        lat: null,
        lon: null,
      },
    ]);
  });
});
