import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DateInput, resolveDate } from '@file-seiri/core';
import { ExifTool } from 'exiftool-vendored';
import { makeTempDir } from '../test-helpers.ts';
import { createMetadataReader, type MetadataReader } from './reader.ts';

const FIXTURES = join(import.meta.dir, 'fixtures');
const OPTIONS = {
  now: new Date('2026-10-18T00:00:00Z'),
  timeZone: 'Asia/Tokyo',
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

let reader: MetadataReader;
beforeAll(() => {
  reader = createMetadataReader({ maxProcs: 2 });
});
afterAll(async () => {
  await reader.close();
});

/** 合成の写真(32x32)を、一時フォルダにコピーして、タグを書く */
const makePhoto = async (
  tags: Record<string, string | number>
): Promise<string> => {
  const path = join(newDir(), 'photo.jpg');
  copyFileSync(join(FIXTURES, 'base.jpg'), path);
  const writer = new ExifTool();
  try {
    await writer.write(path, tags, { writeArgs: ['-overwrite_original'] });
  } finally {
    await writer.end();
  }
  return path;
};

const read = async (path: string, isVideo: boolean) => {
  const result = await reader.read(path, isVideo);
  if (!result.ok) throw new Error(`読めるはず: ${result.error}`);
  return result.metadata;
};

describe('写真(実際の ExifTool)', () => {
  test('撮影日時・カメラ・GPS・寸法を読み、core の日付の決定に渡せる', async () => {
    const path = await makePhoto({
      DateTimeOriginal: '2024:03:05 10:20:30',
      OffsetTimeOriginal: '+09:00',
      Make: 'TestMake',
      Model: 'TestModel',
      LensModel: 'TestLens',
      GPSLatitude: 35.6812,
      GPSLatitudeRef: 'N',
      GPSLongitude: 139.7671,
      GPSLongitudeRef: 'E',
      GPSAltitude: 12.5,
    });
    const metadata = await read(path, false);
    expect(metadata.details).toMatchObject({
      cameraMake: 'TestMake',
      cameraModel: 'TestModel',
      lensModel: 'TestLens',
      width: 32,
      height: 32,
      gpsAlt: 12.5,
    });
    expect(metadata.details.gpsLat).toBeCloseTo(35.6812, 4);
    expect(metadata.details.gpsLon).toBeCloseTo(139.7671, 4);

    const input: DateInput = { fileName: 'photo.jpg', ...metadata.dates };
    const date = resolveDate(input, OPTIONS);
    expect(date).toMatchObject({
      precision: 'full',
      source: 'exif',
      parts: { year: 2024, month: 3, day: 5, hour: 10, minute: 20, second: 30 },
    });
  });

  test('日付のない写真は、日付なし(none)。ファイル名で補える', async () => {
    const path = join(newDir(), 'IMG_20240305_102030.jpg');
    copyFileSync(join(FIXTURES, 'base.jpg'), path);
    const metadata = await read(path, false);
    expect(metadata.dates).toEqual({});
    expect(
      resolveDate(
        { fileName: 'IMG_20240305_102030.jpg', ...metadata.dates },
        OPTIONS
      )
    ).toMatchObject({
      precision: 'full',
      source: 'filename',
    });
  });

  test('不正な日付(0000:00:00 00:00:00)は、unparsable。core では invalid になる', async () => {
    // ExifTool は、不正な日付を書けないため、同じ長さの文字列に、バイトで置き換える
    const path = await makePhoto({ DateTimeOriginal: '2024:03:05 10:20:30' });
    const bytes = readFileSync(path);
    const at = bytes.indexOf('2024:03:05 10:20:30');
    expect(at).toBeGreaterThan(0);
    bytes.write('0000:00:00 00:00:00', at, 'ascii');
    writeFileSync(path, bytes);

    const metadata = await read(path, false);
    expect(metadata.dates.exif?.dateTimeOriginal).toEqual({
      kind: 'unparsable',
    });
    expect(
      resolveDate({ fileName: 'photo.jpg', ...metadata.dates }, OPTIONS)
    ).toMatchObject({
      precision: 'invalid',
    });
  });

  test('画像でないファイルは、エラーにはならず、日付も項目もない(破損の検出は、別の段階)', async () => {
    const path = join(newDir(), 'broken.jpg');
    writeFileSync(path, 'not an image at all');
    const metadata = await read(path, false);
    expect(metadata.dates).toEqual({});
  });
});

describe('動画(実際の ExifTool)', () => {
  test('QuickTime の UTC を、UTC の瞬間として読み、core が本機のタイムゾーンに変換する', async () => {
    const metadata = await read(join(FIXTURES, 'utc.mp4'), true);
    expect(metadata.dates.videoCreateDateUtc).toEqual({
      kind: 'value',
      parts: { year: 2024, month: 3, day: 5, hour: 1, minute: 2, second: 3 },
    });
    expect(metadata.details).toMatchObject({
      width: 32,
      height: 32,
      durationSec: 1,
    });
    expect(metadata.details.gpsLat).toBeCloseTo(35.6812, 3);

    const date = resolveDate(
      { fileName: 'utc.mp4', ...metadata.dates },
      OPTIONS
    );
    // UTC 01:02:03 → 東京 10:02:03
    expect(date).toMatchObject({
      precision: 'full',
      source: 'video',
      parts: { year: 2024, month: 3, day: 5, hour: 10, minute: 2, second: 3 },
    });
  });

  test('mkv の撮影日時(UTC)も、同じ瞬間', async () => {
    const metadata = await read(join(FIXTURES, 'utc.mkv'), true);
    expect(metadata.dates.videoCreateDateUtc).toEqual({
      kind: 'value',
      parts: { year: 2024, month: 3, day: 5, hour: 1, minute: 2, second: 3 },
    });
  });

  test('作成日時が 0 の動画は、unparsable。core では invalid', async () => {
    const metadata = await read(join(FIXTURES, 'nodate.mp4'), true);
    expect(metadata.dates).toEqual({
      videoCreateDateUtc: { kind: 'unparsable' },
    });
    expect(
      resolveDate({ fileName: 'nodate.mp4', ...metadata.dates }, OPTIONS)
        .precision
    ).toBe('invalid');
  });

  test('本機のタイムゾーンが違っても、同じ結果(TZ を変えて、読み直す)', async () => {
    const previous = process.env.TZ;
    const results: unknown[] = [];
    try {
      for (const zone of ['Asia/Tokyo', 'America/New_York', 'UTC']) {
        process.env.TZ = zone;
        const zoned = createMetadataReader({ maxProcs: 1 });
        try {
          const result = await zoned.read(join(FIXTURES, 'utc.mp4'), true);
          results.push(result.ok ? result.metadata.dates : result.error);
        } finally {
          await zoned.close();
        }
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});

describe('読めないとき', () => {
  test('ファイルがなければ、例外ではなく、ok: false', async () => {
    const result = await reader.read(join(newDir(), 'none.jpg'), false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not found');
  });

  test('同時に、たくさん読める(結果は、それぞれのファイルのもの)', async () => {
    const photos = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        makePhoto({
          DateTimeOriginal: `2024:03:0${index + 1} 10:00:00`,
          Model: `M${index}`,
        })
      )
    );
    const results = await Promise.all(
      photos.map((path) => reader.read(path, false))
    );
    expect(
      results.map((r) => (r.ok ? r.metadata.details.cameraModel : r.error))
    ).toEqual(photos.map((_, index) => `M${index}`));
  });
});
