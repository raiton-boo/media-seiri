import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addFile,
  addPhoto,
  addVideo,
  DATE_2024_03_05,
  fakeThumbnailMaker,
  initLibrary,
  installExifWriter,
  makeWorld,
  openWorldLedger,
  runIn,
  type World,
} from '../ingest/test-support.ts';
import { libraryThumbsDir } from './sync.ts';

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

const ingest = (world: World, options: Parameters<typeof runIn>[2] = {}) =>
  runIn(
    world,
    ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, '--yes'],
    options
  );

type Row = Record<string, unknown>;
const rows = (world: World, sql: string): Row[] => {
  const ledger = openWorldLedger(world);
  try {
    return ledger.db.query(sql).all() as Row[];
  } finally {
    ledger.close();
  }
};

const dataThumbs = (world: World): string =>
  join(world.dataDir, 'libraries', 'lib-1', 'thumbs');

/** ディレクトリの下の、ファイルの相対パス(一時ファイルを除く) */
const filesUnder = (directory: string): string[] =>
  existsSync(directory)
    ? readdirSync(directory, { recursive: true })
        .map(String)
        .filter((name) => /\/[0-9a-f]{64}\.jpg$/.test(name))
        .sort()
    : [];

const thumbPaths = (world: World): (string | null)[] =>
  rows(
    world,
    'SELECT thumb_rel_path AS t FROM library_files ORDER BY rel_path'
  ).map((row) => row.t as string | null);

describe('ingest: サムネイル', () => {
  test('取り込みの最後に、写真・動画のサムネイルを作り、台帳に記録し、ライブラリへコピーする', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    addVideo(world, 'DCIM/v.mp4');
    const maker = fakeThumbnailMaker();
    const result = await ingest(world, { thumbnailMaker: () => maker });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(maker.requests.map((request) => request.kind).sort()).toEqual([
      'photo',
      'video',
    ]);
    const paths = thumbPaths(world);
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path !== null)).toBe(true);
    // 名前は、内容のハッシュ(2 文字のフォルダ / ハッシュ.jpg)
    const hashes = rows(world, 'SELECT hash FROM contents').map(
      (row) => `${String(row.hash).slice(0, 2)}/${row.hash}.jpg`
    );
    expect([...paths].sort()).toEqual(hashes.sort());
    expect(filesUnder(dataThumbs(world))).toEqual(hashes.sort());
    expect(filesUnder(libraryThumbsDir(world.library))).toEqual(hashes.sort());
    expect(result.stdout.join('\n')).toContain('サムネイル: 作成 2');
  });

  test('作れなかったファイルは、WARN にして、取り込みは成功する。記録は空のまま', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2024:03:06 10:00:00',
    });
    const maker = fakeThumbnailMaker((request) =>
      request.sourcePath.includes('_b.') ? 'デコードできません' : undefined
    );
    const result = await ingest(world, { thumbnailMaker: () => maker });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(
      rows(
        world,
        "SELECT message FROM events WHERE code = 'THUMB_FAILED' AND level = 'WARN'"
      )
    ).toHaveLength(1);
    expect(thumbPaths(world).filter((path) => path === null)).toHaveLength(1);
    expect(rows(world, 'SELECT count(*) AS n FROM errors')[0]).toEqual({
      n: 0,
    });
  });

  test('写真・動画・RAW 以外(XMP)は、サムネイルの対象にしない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    addFile(world, 'DCIM/a.xmp', '<x/>');
    const maker = fakeThumbnailMaker();
    const result = await ingest(world, { thumbnailMaker: () => maker });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(maker.requests.map((request) => request.kind)).toEqual(['photo']);
  });
});

describe('thumbs コマンド', () => {
  test('取り込みで作れなかった分だけを作り、実行として記録し、リビジョンを進める', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2024:03:06 10:00:00',
    });
    await ingest(world, {
      thumbnailMaker: () => fakeThumbnailMaker(() => '失敗'),
    });
    expect(thumbPaths(world)).toEqual([null, null]);
    const revisionBefore = rows(
      world,
      "SELECT value FROM meta WHERE key = 'revision'"
    )[0]?.value;

    const maker = fakeThumbnailMaker();
    const result = await runIn(world, ['thumbs', '--library', world.library], {
      thumbnailMaker: () => maker,
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(maker.requests).toHaveLength(2);
    expect(thumbPaths(world).every((path) => path !== null)).toBe(true);
    expect(filesUnder(libraryThumbsDir(world.library))).toHaveLength(2);
    expect(
      rows(world, "SELECT status FROM runs WHERE kind = 'thumbs'")
    ).toEqual([{ status: 'completed' }]);
    expect(
      Number(
        rows(world, "SELECT value FROM meta WHERE key = 'revision'")[0]?.value
      )
    ).toBeGreaterThan(Number(revisionBefore));

    // スナップショットにも、サムネイルの場所が入っている
    expect(
      existsSync(join(world.library, '.file-seiri', 'catalog.snapshot.sqlite'))
    ).toBe(true);
  });

  test('もう一度実行しても、何も作り直さない(何度でも実行できる)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    const maker = fakeThumbnailMaker();
    const result = await runIn(world, ['thumbs', '--library', world.library], {
      thumbnailMaker: () => maker,
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(maker.requests).toHaveLength(0);
    expect(result.stdout.join('\n')).toContain('既存 1');
  });

  test('正本のサムネイルが消えていたら、作り直す。ライブラリ側が消えていたら、コピーし直す', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world);
    const [name] = filesUnder(dataThumbs(world));
    rmSync(join(dataThumbs(world), name as string));
    rmSync(join(libraryThumbsDir(world.library), name as string));
    const maker = fakeThumbnailMaker();
    const result = await runIn(world, ['thumbs', '--library', world.library], {
      thumbnailMaker: () => maker,
    });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(maker.requests).toHaveLength(1);
    expect(filesUnder(dataThumbs(world))).toEqual([name as string]);
    expect(filesUnder(libraryThumbsDir(world.library))).toEqual([
      name as string,
    ]);

    // ライブラリ側だけが、途中で切れていた(大きさが違う)ときも、コピーし直す
    const copied = join(libraryThumbsDir(world.library), name as string);
    writeFileSync(copied, 'x');
    const again = await runIn(world, ['thumbs', '--library', world.library], {
      thumbnailMaker: () => fakeThumbnailMaker(),
    });
    expect(again.code).toBe(EXIT_CODES.ok);
    expect(Bun.file(copied).size).toBe(
      Bun.file(join(dataThumbs(world), name as string)).size
    );
  });

  test('作れないものがあれば、終了コードは 1(WARN の記録も残る)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await ingest(world, {
      thumbnailMaker: () => fakeThumbnailMaker(() => '失敗'),
    });
    const result = await runIn(world, ['thumbs', '--library', world.library], {
      thumbnailMaker: () => fakeThumbnailMaker(() => '壊れています'),
    });
    expect(result.code).toBe(EXIT_CODES.completedWithErrors);
    expect(result.stdout.join('\n')).toContain('失敗 1');
    expect(
      rows(
        world,
        "SELECT count(*) AS n FROM events WHERE code = 'THUMB_FAILED' AND level = 'WARN'"
      )[0]
    ).toEqual({ n: 2 });
  });

  test('中断(Ctrl-C)したら、130 で止まり、もう一度実行すると、残りから続ける', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await addPhoto(world, 'DCIM/b.jpg', {
      DateTimeOriginal: '2024:03:06 10:00:00',
    });
    await ingest(world, {
      thumbnailMaker: () => fakeThumbnailMaker(() => '失敗'),
    });
    const stopped = await runIn(world, ['thumbs', '--library', world.library], {
      shouldStop: () => true,
    });
    expect(stopped.code).toBe(EXIT_CODES.interrupted);
    expect(
      rows(world, "SELECT status FROM runs WHERE kind = 'thumbs'")
    ).toEqual([{ status: 'interrupted' }]);
    expect(thumbPaths(world)).toEqual([null, null]);

    const resumed = await runIn(world, ['thumbs', '--library', world.library]);
    expect(resumed.code).toBe(EXIT_CODES.ok);
    expect(thumbPaths(world).every((path) => path !== null)).toBe(true);
  });

  test('ライブラリでない場所を指すと、エラーで止まる', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['thumbs', '--library', world.srcRoot]);
    expect(result.code).toBe(EXIT_CODES.failed);
  });
});
