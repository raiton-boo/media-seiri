import { describe, expect, test } from 'bun:test';
import { resolveDate } from '@file-seiri/core';
import { openDb, seedContent } from './fixtures.ts';
import { getMediaMetadata, upsertMediaMetadata } from './media-metadata.ts';

const OPTIONS = {
  now: new Date('2026-10-18T00:00:00Z'),
  timeZone: 'Asia/Tokyo',
};

describe('media_metadata', () => {
  test('EXIF の日付と、カメラ・GPS を保存して、読める', () => {
    const db = openDb();
    const contentId = seedContent(db);
    const date = resolveDate(
      {
        fileName: 'IMG_0001.JPG',
        exif: {
          dateTimeOriginal: {
            kind: 'value',
            parts: {
              year: 2024,
              month: 3,
              day: 5,
              hour: 10,
              minute: 20,
              second: 30,
            },
          },
        },
        mtime: new Date(1_700_000_000_123),
      },
      OPTIONS
    );
    upsertMediaMetadata(db, {
      contentId,
      date,
      cameraMake: 'Canon',
      cameraModel: 'EOS R6',
      width: 6000,
      height: 4000,
      gpsLat: 35.68,
      gpsLon: 139.76,
    });
    expect(getMediaMetadata(db, contentId)).toEqual({
      contentId,
      takenAt: '2024-03-05T10:20:30',
      datePrecision: 'full',
      dateSource: 'exif',
      dateReason: '',
      mtimeRefMs: 1_700_000_000_123,
      cameraMake: 'Canon',
      cameraModel: 'EOS R6',
      lensModel: null,
      width: 6000,
      height: 4000,
      durationSec: null,
      gpsLat: 35.68,
      gpsLon: 139.76,
      gpsAlt: null,
    });
  });

  test('日付が取れなかったとき(none)は、taken_at が null で、更新日は参考として残る', () => {
    const db = openDb();
    const contentId = seedContent(db);
    const date = resolveDate(
      { fileName: 'IMG_0001.JPG', mtime: new Date(1_700_000_000_000) },
      OPTIONS
    );
    upsertMediaMetadata(db, { contentId, date });
    expect(getMediaMetadata(db, contentId)).toMatchObject({
      takenAt: null,
      datePrecision: 'none',
      dateSource: 'none',
      mtimeRefMs: 1_700_000_000_000,
    });
  });

  test('ファイル名の日付(フォールバック)は、理由つきで、精度までの日時になる', () => {
    const db = openDb();
    const contentId = seedContent(db);
    const date = resolveDate({ fileName: 'IMG_20240305_102030.jpg' }, OPTIONS);
    upsertMediaMetadata(db, { contentId, date });
    const saved = getMediaMetadata(db, contentId);
    expect(saved?.dateSource).toBe('filename');
    expect(saved?.dateReason).not.toBe('');
    expect(saved?.takenAt).toMatch(/^2024-03-05/);
  });

  test('同じ内容に保存し直すと、上書きする。ないものは undefined', () => {
    const db = openDb();
    const contentId = seedContent(db);
    expect(getMediaMetadata(db, contentId)).toBeUndefined();
    upsertMediaMetadata(db, {
      contentId,
      date: resolveDate({ fileName: 'a.jpg' }, OPTIONS),
      width: 1,
    });
    upsertMediaMetadata(db, {
      contentId,
      date: resolveDate({ fileName: 'a.jpg' }, OPTIONS),
      width: 2,
    });
    expect(getMediaMetadata(db, contentId)?.width).toBe(2);
  });

  test('ない内容には、保存できない', () => {
    expect(() =>
      upsertMediaMetadata(openDb(), {
        contentId: 999,
        date: resolveDate({ fileName: 'a.jpg' }, OPTIONS),
      })
    ).toThrow();
  });
});
