import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip, CP932_AIU, type TestEntry } from '../archive/test-zip.ts';
import {
  addFile,
  addPhoto,
  DATE_2024_03_05,
  initLibrary,
  installExifWriter,
  makeWorld,
  openWorldLedger,
  runIn,
  type World,
} from './test-support.ts';

installExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});
const newWorld = async (): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  return world;
};

const ingest = (world: World, ...extra: string[]) =>
  runIn(world, [
    'ingest',
    join(world.srcRoot, 'DCIM'),
    '--dest',
    world.library,
    '--yes',
    ...extra,
  ]);

type Row = Record<string, unknown>;
const rows = (
  world: World,
  sql: string,
  ...params: (string | number)[]
): Row[] => {
  const ledger = openWorldLedger(world);
  try {
    return ledger.db.query(sql).all(...params) as Row[];
  } finally {
    ledger.close();
  }
};

/** 合成の写真(EXIF つき)のバイト列。ZIP に入れるための、材料 */
const photoBytes = async (
  world: World,
  name: string,
  tags = {}
): Promise<Buffer> => {
  const path = await addPhoto(world, `_material/${name}`, tags);
  return readFileSync(path);
};

const tmpLeftovers = (world: World): string[] => {
  const dir = join(world.dataDir, 'libraries', 'lib-1', 'tmp');
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('ZIP の取り込み', () => {
  test('中の写真を、通常のファイルと同じ規則でコピーする。元の ZIP は、変わらない。一時ファイルは、残らない', async () => {
    const world = await newWorld();
    const zip = buildZip([
      { name: 'trip/' },
      {
        name: 'trip/a.jpg',
        data: await photoBytes(world, 'a.jpg', DATE_2024_03_05),
        method: 'deflate',
      },
    ]);
    const zipPath = addFile(world, 'DCIM/photos.zip', zip);
    const before = readFileSync(zipPath);

    const result = await ingest(world);
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(
      existsSync(join(world.library, '2024/03/2024.03.05_10-20-30_a.jpg'))
    ).toBe(true);
    expect(readFileSync(zipPath).equals(before)).toBe(true);
    // 元の場所の記録: `DCIM/photos.zip!/trip/a.jpg`
    expect(
      rows(
        world,
        "SELECT rel_path, state FROM source_files WHERE rel_path LIKE '%!%'"
      )
    ).toEqual([{ rel_path: 'DCIM/photos.zip!/trip/a.jpg', state: 'done' }]);
    expect(tmpLeftovers(world)).toEqual([]);
    expect(result.stdout.join('\n')).toMatch(/ZIP 1\(開いた 1\)/);
  });

  test('2 回目の実行は、処理済みとして、取り出さない(コピーも、二重にしない)', async () => {
    const world = await newWorld();
    addFile(
      world,
      'DCIM/photos.zip',
      buildZip([
        {
          name: 'a.jpg',
          data: await photoBytes(world, 'a.jpg', DATE_2024_03_05),
        },
      ])
    );
    await ingest(world);
    const second = await ingest(world);
    expect(second.code).toBe(0);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')[0]?.n).toBe(
      1
    );
    expect(second.stdout.join('\n')).toMatch(/処理済み/);
  });

  test('ZIP の中と外の、同じ内容は、重複として、1 つにする', async () => {
    const world = await newWorld();
    const bytes = await photoBytes(world, 'a.jpg', DATE_2024_03_05);
    addFile(world, 'DCIM/a.jpg', bytes);
    addFile(
      world,
      'DCIM/photos.zip',
      buildZip([{ name: 'copy.jpg', data: bytes }])
    );
    await ingest(world);
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')[0]?.n).toBe(
      1
    );
    expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')[0]?.n).toBe(
      1
    );
  });

  test('入れ子の ZIP: 深さ 3 まで開く。4 段目は、開かず、警告', async () => {
    const world = await newWorld();
    const bytes = await photoBytes(world, 'deep.jpg', DATE_2024_03_05);
    const level3 = buildZip([
      {
        name: 'p3.jpg',
        data: await photoBytes(world, 'p3.jpg', {
          DateTimeOriginal: '2023:01:01 01:01:01',
        }),
      },
    ]);
    const level4 = buildZip([{ name: 'p4.jpg', data: bytes }]);
    const level2 = buildZip([
      { name: 'level3.zip', data: Buffer.concat([level3]) },
      {
        name: 'p2.jpg',
        data: await photoBytes(world, 'p2.jpg', {
          DateTimeOriginal: '2022:02:02 02:02:02',
        }),
      },
    ]);
    // level1(ディスク)→ level2 → level3(深さ 3。開く)→ level4(深さ 4。開かない)
    const level3WithDeeper = buildZip([
      {
        name: 'p3.jpg',
        data: await photoBytes(world, 'p3b.jpg', {
          DateTimeOriginal: '2023:01:01 01:01:01',
        }),
      },
      { name: 'level4.zip', data: level4 },
    ]);
    const level2Deep = buildZip([
      { name: 'level3.zip', data: level3WithDeeper },
    ]);
    addFile(
      world,
      'DCIM/level1.zip',
      buildZip([
        { name: 'level2.zip', data: level2Deep },
        { name: 'level2b.zip', data: level2 },
      ])
    );
    const result = await ingest(world);
    const paths = rows(
      world,
      'SELECT rel_path FROM source_files ORDER BY rel_path'
    ).map((r) => r.rel_path);
    expect(paths).toContain('DCIM/level1.zip!/level2.zip!/level3.zip!/p3.jpg');
    expect(paths).toContain('DCIM/level1.zip!/level2b.zip!/p2.jpg');
    // 4 段目の中の写真は、取り込まない
    expect(paths.some((p) => String(p).includes('level4.zip!'))).toBe(false);
    const warnings = rows(
      world,
      "SELECT message FROM events WHERE code = 'ZIP_DEPTH_EXCEEDED'"
    );
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.message)).toContain('level4.zip');
    expect(result.stdout.join('\n')).toMatch(/警告 1/);
    expect(tmpLeftovers(world)).toEqual([]);
  });

  test('ZIP の中に、同じ名前のファイルが複数あっても、落ちずに、連番を付けて、すべて取り込む(警告)', async () => {
    const world = await newWorld();
    const first = await photoBytes(world, 'a1.jpg', DATE_2024_03_05);
    const second = await photoBytes(world, 'a2.jpg', {
      DateTimeOriginal: '2023:01:01 01:01:01',
    });
    addFile(
      world,
      'DCIM/dup.zip',
      buildZip([
        { name: 'same.jpg', data: first },
        { name: 'same.jpg', data: second },
        { name: 'sub/same.jpg', data: first },
      ])
    );
    const result = await ingest(world);
    expect(result.code).toBe(0);
    const paths = rows(
      world,
      'SELECT rel_path FROM source_files ORDER BY rel_path'
    ).map((r) => r.rel_path);
    expect(paths).toEqual([
      'DCIM/dup.zip!/same (2).jpg',
      'DCIM/dup.zip!/same.jpg',
      'DCIM/dup.zip!/sub/same.jpg',
    ]);
    const warnings = rows(
      world,
      "SELECT message FROM events WHERE code = 'ZIP_DUPLICATE_ENTRY'"
    );
    expect(warnings).toHaveLength(1);
    expect(result.stdout.join('\n')).toMatch(/警告 1/);
  });

  test('危険なパス・暗号化・壊れた ZIP は、エラーとして記録し、ほかの中身は、続ける', async () => {
    const world = await newWorld();
    const good = await photoBytes(world, 'good.jpg', DATE_2024_03_05);
    addFile(
      world,
      'DCIM/mixed.zip',
      buildZip([
        { name: '../evil.jpg', data: good },
        { name: '/abs.jpg', data: good },
        { name: 'locked.jpg', data: 'x', encrypted: true },
        { name: 'ok.jpg', data: good },
      ])
    );
    addFile(world, 'DCIM/broken.zip', 'this is not a zip');
    const result = await ingest(world);
    const codes = rows(
      world,
      'SELECT code, detail FROM errors ORDER BY error_id'
    );
    const byCode = (code: string) => codes.filter((row) => row.code === code);
    expect(byCode('ZIP_UNSAFE_PATH')).toHaveLength(2);
    expect(byCode('ZIP_ENCRYPTED')).toHaveLength(1);
    expect(byCode('READ_FAILED')).toHaveLength(1);
    expect(String(byCode('ZIP_UNSAFE_PATH')[0]?.detail)).toContain(
      'mixed.zip!/../evil.jpg'
    );
    // 安全なものは、取り込む。危険なものは、展開しない(ライブラリの外にも、書かない)
    expect(
      rows(
        world,
        "SELECT rel_path FROM source_files WHERE rel_path LIKE '%!%'"
      ).map((r) => r.rel_path)
    ).toEqual(['DCIM/mixed.zip!/ok.jpg']);
    expect(existsSync(join(world.base, 'evil.jpg'))).toBe(false);
    expect(result.code).toBe(1);
    expect(tmpLeftovers(world)).toEqual([]);
  });

  test('cp932 の名前は、文字化けせずに記録する', async () => {
    const world = await newWorld();
    const entry: TestEntry = {
      name: new Uint8Array([...CP932_AIU, 0x2e, 0x6a, 0x70, 0x67]),
      data: await photoBytes(world, 'x.jpg', DATE_2024_03_05),
    };
    addFile(world, 'DCIM/jp.zip', buildZip([entry]));
    await ingest(world);
    expect(
      rows(
        world,
        "SELECT rel_path FROM source_files WHERE rel_path LIKE '%!%'"
      ).map((r) => r.rel_path)
    ).toEqual(['DCIM/jp.zip!/あいう.jpg']);
    expect(
      existsSync(join(world.library, '2024/03/2024.03.05_10-20-30_あいう.jpg'))
    ).toBe(true);
  });

  test('ZIP の中の Takeout の json から、日付を決める(フォールバック json)', async () => {
    const world = await newWorld();
    const bytes = await photoBytes(world, 'takeout.jpg');
    addFile(
      world,
      'DCIM/takeout.zip',
      buildZip([
        { name: 'Takeout/Google Photos/takeout.jpg', data: bytes },
        {
          name: 'Takeout/Google Photos/takeout.jpg.json',
          data: JSON.stringify({
            photoTakenTime: { timestamp: '1709600523' },
            geoData: { latitude: 35.6586, longitude: 139.7454, altitude: 3 },
          }),
        },
      ])
    );
    const result = await ingest(world);
    expect(
      existsSync(join(world.library, '2024/03/2024.03.05_10-02-03_takeout.jpg'))
    ).toBe(true);
    expect(
      rows(world, 'SELECT date_source FROM media_metadata').map(
        (r) => r.date_source
      )
    ).toEqual(['json']);
    expect(
      rows(world, 'SELECT gps_lat FROM media_metadata')[0]?.gps_lat
    ).toBeCloseTo(35.6586);
    expect(result.stdout.join('\n')).toMatch(/Takeout の json 1/);
  });

  test('壊れた ZIP(途中まで読める)は、読めた分を取り込み、残りは、エラー', async () => {
    const world = await newWorld();
    const good = await photoBytes(world, 'a.jpg', DATE_2024_03_05);
    addFile(
      world,
      'DCIM/partial.zip',
      buildZip([{ name: 'a.jpg', data: good }], { centralDirectory: false })
    );
    const result = await ingest(world);
    expect(
      existsSync(join(world.library, '2024/03/2024.03.05_10-20-30_a.jpg'))
    ).toBe(true);
    expect(
      rows(world, "SELECT code FROM errors WHERE code = 'READ_FAILED'")
    ).toHaveLength(1);
    expect(result.code).toBe(1);
  });
});
