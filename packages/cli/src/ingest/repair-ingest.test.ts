import { afterEach, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepairTools } from '../repair/index.ts';
import {
  addFile,
  FIXTURES,
  initLibrary,
  makeWorld,
  openWorldLedger,
  runIn,
  useExifWriter,
  type World,
} from './test-support.ts';

useExifWriter();

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

/** ExifTool が「ファイル形式の誤り」とする、でたらめなバイト列(JPEG ではない)。`marker` を末尾に付ける */
const junk = (marker: string): Buffer =>
  Buffer.concat([
    Buffer.from(Uint8Array.from({ length: 3072 }, (_, i) => i % 256)),
    Buffer.from(marker),
  ]);

/** 「BROKEN」を含む内容のファイルを壊れているとする、偽の道具。`salvage` が、直せるか */
const fakeTools = (
  options: { salvage?: boolean; skipAll?: boolean } = {}
): RepairTools & { checked: string[] } => {
  const checked: string[] = [];
  return {
    checked,
    check: async (path) => {
      checked.push(path);
      return readFileSync(path).includes('BROKEN')
        ? { status: 'corrupt', detail: '途中で切れています' }
        : { status: 'ok' };
    },
    remuxVideo: async () => ({ ok: false, skipped: true, detail: '試験' }),
    rewriteMetadata: async () =>
      options.skipAll
        ? { ok: false, skipped: true, detail: 'ExifTool が使えません' }
        : { ok: false, detail: '書き直せませんでした' },
    salvageImage: async (_source, dest) => {
      if (options.skipAll)
        return { ok: false, skipped: true, detail: 'ffmpeg が使えません' };
      if (!options.salvage)
        return { ok: false, detail: '読み取れる画像データがありません' };
      // 正しい(検査が ok になる)画像を、出力にする
      copyFileSync(join(FIXTURES, 'base.jpg'), dest);
      return { ok: true, detail: '読み取れる範囲の画像を、保存しました' };
    },
    close: async () => {},
  };
};

const ingest = (world: World, tools: RepairTools, ...extra: string[]) =>
  runIn(
    world,
    [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
      ...extra,
    ],
    {
      repairTools: () => tools,
    }
  );

const listLibrary = (world: World): string[] =>
  existsSync(world.library)
    ? readdirSync(world.library, { recursive: true })
        .map(String)
        .filter((p) => !p.startsWith('.file-seiri') && p.includes('.'))
        .sort()
    : [];

describe('破損の検査と修復', () => {
  test('メタデータが読めず、デコードも失敗するファイルを、修復して取り込む(修復済みの印・修復後も日付がなければ、専用の場所)', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/broken.jpg', junk('BROKEN'));
    const tools = fakeTools({ salvage: true });
    const result = await ingest(world, tools);
    expect(result.code).toBe(0);
    // 元は、変わらない
    expect(
      readFileSync(join(world.srcRoot, 'DCIM/broken.jpg')).equals(
        junk('BROKEN')
      )
    ).toBe(true);
    // 修復後のファイルが、ライブラリに入る。日付がなければ「修復後も日付なし」
    expect(listLibrary(world)).toContain(
      '_unknown/修復後も日付なし/broken.jpg'
    );
    expect(
      rows(world, 'SELECT rel_path, bucket, is_repaired FROM library_files')
    ).toEqual([
      {
        rel_path: '_unknown/修復後も日付なし/broken.jpg',
        bucket: 'unknown_repaired_nodate',
        is_repaired: 1,
      },
    ]);
    // 元の場所は、元のソースのパス
    expect(rows(world, 'SELECT rel_path, state FROM source_files')).toEqual([
      { rel_path: 'DCIM/broken.jpg', state: 'done' },
    ]);
    // 試した手順(再書込みは失敗、救出は成功)と、修復で作った別ファイル
    expect(
      rows(
        world,
        'SELECT method, is_success FROM repair_attempts ORDER BY attempt_id'
      )
    ).toEqual([
      { method: 'metadata_rewrite', is_success: 0 },
      { method: 'image_salvage', is_success: 1 },
    ]);
    const output = String(
      rows(
        world,
        'SELECT output_path FROM repair_attempts WHERE is_success = 1'
      )[0]?.output_path
    );
    expect(output).toContain(join('libraries', 'lib-1', 'repaired'));
    expect(existsSync(output)).toBe(true);
    expect(rows(world, 'SELECT count(*) AS n FROM errors')[0]?.n).toBe(0);
    expect(result.stdout.join('\n')).toMatch(
      /破損[^\n]*1 ファイル \(修復 1 \/ 読み取り不可へ 0\)/
    );
  });

  test('直せなかった: REPAIR_FAILED を記録し、元のバイトのまま、読み取り不可へコピーする', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/broken.jpg', junk('BROKEN'));
    const result = await ingest(world, fakeTools({ salvage: false }));
    expect(result.code).toBe(1);
    const copied = join(world.library, '_unknown/読み取り不可/broken.jpg');
    expect(readFileSync(copied).equals(junk('BROKEN'))).toBe(true);
    expect(
      rows(world, 'SELECT bucket, is_repaired FROM library_files')
    ).toEqual([{ bucket: 'unknown_unreadable', is_repaired: 0 }]);
    const errors = rows(world, 'SELECT code, detail FROM errors');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('REPAIR_FAILED');
    // 試した手順と理由が、詳細に入る
    expect(String(errors[0]?.detail)).toContain('メタデータの再書込み: 失敗');
    expect(String(errors[0]?.detail)).toContain('切れた画像の救出: 失敗');
    expect(
      rows(world, 'SELECT is_success FROM repair_attempts').map(
        (r) => r.is_success
      )
    ).toEqual([0, 0]);
    expect(rows(world, 'SELECT state FROM source_files')).toEqual([
      { state: 'done' },
    ]);
  });

  test('修復の道具が使えず、1 つも試せなかった: CORRUPTED(修復は未実施)。バイトは、読み取り不可へ', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/broken.jpg', junk('BROKEN'));
    const result = await ingest(world, fakeTools({ skipAll: true }));
    expect(result.code).toBe(1);
    expect(rows(world, 'SELECT code FROM errors').map((r) => r.code)).toEqual([
      'CORRUPTED',
    ]);
    expect(
      existsSync(join(world.library, '_unknown/読み取り不可/broken.jpg'))
    ).toBe(true);
    expect(rows(world, 'SELECT count(*) AS n FROM repair_attempts')[0]?.n).toBe(
      0
    );
  });

  test('dry-run: 修復は試みない(CORRUPTED)。保存先には、何も書かない', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/broken.jpg', junk('BROKEN'));
    const tools = fakeTools({ salvage: true });
    const result = await ingest(world, tools, '--dry-run');
    expect(rows(world, 'SELECT code FROM errors').map((r) => r.code)).toEqual([
      'CORRUPTED',
    ]);
    expect(
      String(rows(world, 'SELECT detail FROM errors')[0]?.detail)
    ).toContain('dry-run');
    expect(rows(world, 'SELECT count(*) AS n FROM repair_attempts')[0]?.n).toBe(
      0
    );
    expect(listLibrary(world)).toEqual([]);
    // 計画には、読み取り不可への置き場所が出る
    expect(
      rows(world, "SELECT message FROM events WHERE code = 'PLAN_COPY'").map(
        (r) => r.message
      )
    ).toEqual(['DCIM/broken.jpg → _unknown/読み取り不可/broken.jpg']);
    expect(result.code).toBe(1);
  });

  test('メタデータは読めないが、デコードはできる(壊れていない)ファイルは、普通に取り込む', async () => {
    const world = await newWorld();
    // 「BROKEN」を含まない = 検査は ok。メタデータは、読めない(JPEG ではない内容)
    addFile(world, 'DCIM/odd.jpg', junk('ODD'));
    const result = await ingest(world, fakeTools());
    expect(result.code).toBe(0);
    expect(rows(world, 'SELECT count(*) AS n FROM errors')[0]?.n).toBe(0);
    expect(
      rows(world, 'SELECT bucket FROM library_files').map((r) => r.bucket)
    ).toEqual(['unknown_none']);
    expect(rows(world, 'SELECT count(*) AS n FROM repair_attempts')[0]?.n).toBe(
      0
    );
  });

  test('正常なファイルには、検査をかけない(遅くならないように)', async () => {
    const world = await newWorld();
    copyFileSync(join(FIXTURES, 'base.jpg'), join(world.srcRoot, 'ok.jpg'));
    addFile(world, 'DCIM/ok.jpg', readFileSync(join(FIXTURES, 'base.jpg')));
    const tools = fakeTools();
    await ingest(world, tools);
    expect(tools.checked).toEqual([]);
  });

  test('修復後のハッシュで、重複を決める: 修復したものが、すでにある内容と同じなら、重複', async () => {
    const world = await newWorld();
    addFile(world, 'DCIM/a.jpg', readFileSync(join(FIXTURES, 'base.jpg')));
    addFile(world, 'DCIM/broken.jpg', junk('BROKEN'));
    // 救出の結果は base.jpg と同じバイト列 → a.jpg と、同じ内容
    await ingest(world, fakeTools({ salvage: true }));
    expect(rows(world, 'SELECT count(*) AS n FROM library_files')[0]?.n).toBe(
      1
    );
    expect(rows(world, 'SELECT count(*) AS n FROM duplicate_links')[0]?.n).toBe(
      1
    );
  });
});
