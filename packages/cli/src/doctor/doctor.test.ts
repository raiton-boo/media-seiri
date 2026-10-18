import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { readConfig, registerLibrary } from '../config/registry.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  type World,
} from '../ingest/test-support.ts';
import { markerPathOf } from '../library/marker.ts';
import { isEmptyLibrary } from '../library/remove.ts';

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

const ingested = async (): Promise<World> => {
  const world = await newWorld();
  await addPhoto(world, 'DCIM/a.jpg', {
    DateTimeOriginal: '2024:03:05 10:20:30',
  });
  const result = await runIn(world, [
    'ingest',
    join(world.srcRoot, 'DCIM'),
    '--dest',
    world.library,
    '--yes',
  ]);
  expect(result.code).toBe(0);
  return world;
};

describe('seiri doctor', () => {
  test('取り込み済みの正常なライブラリは、問題なし(0)', async () => {
    const world = await ingested();
    const result = await runIn(world, ['doctor']);
    expect(result.code).toBe(0);
    const text = result.stdout.join('\n');
    expect(text).toContain('台帳の整合は、正常です');
    expect(text).toContain('スナップショットは、最新です');
    expect(text).toMatch(/診断: 要対応 0 件/);
  });

  test('古い登録・一時ファイルを見つけ、--fix で直す(写真は、消さない)', async () => {
    const world = await ingested();
    registerLibrary(world.dataDir, 'old-1', {
      root: world.library,
      registeredAt: '2026-10-01T00:00:00.000Z',
    });
    const part = join(world.library, '2024', '.IMG_0001.jpg.part');
    mkdirSync(join(world.library, '2024'), { recursive: true });
    writeFileSync(part, 'x');

    const diagnosis = await runIn(world, ['doctor']);
    expect(diagnosis.code).toBe(1);
    const text = diagnosis.stdout.join('\n');
    expect(text).toContain('古い登録が 1 件');
    expect(text).toContain('一時ファイルが 1 件');
    expect(existsSync(part)).toBe(true);

    // 端末でなく、--yes もなければ、直さない
    const refused = await runIn(world, ['doctor', '--fix']);
    expect(refused.code).toBe(2);
    expect(existsSync(part)).toBe(true);

    const fixed = await runIn(world, ['doctor', '--fix', '--yes']);
    expect(fixed.code).toBe(0);
    expect(existsSync(part)).toBe(false);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual(['lib-1']);
    // 写真は、そのまま
    expect(readdirSync(world.library).length).toBeGreaterThan(0);
  });

  test('間違えて作った(空の)ライブラリを、知らせる', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['doctor']);
    expect(result.stdout.join('\n')).toContain('中身のないライブラリ');
    expect(result.stdout.join('\n')).toContain('library remove');
  });

  test('外のコマンドがなければ、使えなくなる機能と、入れ方を案内する(perl は、問題)', async () => {
    const world = await ingested();
    const result = await runIn(world, ['doctor'], {
      findTool: (name) => (name === 'sips' ? '/usr/bin/sips' : undefined),
    });
    expect(result.code).toBe(1);
    const text = result.stdout.join('\n');
    expect(text).toContain('ffmpeg が見つかりません');
    expect(text).toContain('brew install ffmpeg');
    expect(text).toContain('perl が見つかりません');
  });

  test('台帳が壊れていれば、問題として知らせる', async () => {
    const world = await ingested();
    // 台帳の中身を、壊す(先頭を、でたらめにする)
    const { ledgerPathFor } = await import('../config/paths.ts');
    const path = ledgerPathFor(world.dataDir, 'lib-1');
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    for (let i = 100; i < 4000 && i < bytes.length; i += 1) bytes[i] = 0x7f;
    writeFileSync(path, bytes);
    const result = await runIn(world, ['doctor']);
    expect(result.code).toBe(1);
    expect(result.stdout.join('\n')).toMatch(
      /台帳(を開けません|の整合に、問題があります)/
    );
  });
});

describe('seiri doctor --deep', () => {
  test('正常なら、問題なし。ファイルの消失・大きさの違い・サムネイルなしを、見つける', async () => {
    const world = await ingested();
    const clean = await runIn(world, ['doctor', '--deep']);
    expect(clean.code).toBe(0);
    expect(clean.stdout.join('\n')).toContain(
      '存在・大きさ・サムネイルは、正常です'
    );

    // 取り込んだ写真の場所を探して、壊す(消す・切り詰める)
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else found.push(path);
      }
    };
    walk(world.library);
    expect(found.length).toBeGreaterThan(0);
    const target = found[0] as string;
    writeFileSync(target, 'short');
    const wrong = await runIn(world, ['doctor', '--deep']);
    expect(wrong.code).toBe(1);
    expect(wrong.stdout.join('\n')).toContain('大きさが違うファイルが 1 件');

    rmSync(target);
    const missing = await runIn(world, ['doctor', '--deep']);
    expect(missing.stdout.join('\n')).toContain(
      'ファイルが見つからないものが 1 件'
    );
  });
});

describe('library remove / forget', () => {
  test('空のライブラリは、目印・登録・空の台帳を、片づける', async () => {
    const world = await newWorld();
    expect(isEmptyLibrary(world.library)).toBe(true);
    // 確認なし(端末でない)では、実行しない
    const refused = await runIn(world, ['library', 'remove', world.library]);
    expect(refused.code).toBe(2);
    expect(existsSync(markerPathOf(world.library))).toBe(true);

    const done = await runIn(world, [
      'library',
      'remove',
      world.library,
      '--yes',
    ]);
    expect(done.code).toBe(0);
    expect(existsSync(markerPathOf(world.library))).toBe(false);
    expect(existsSync(join(world.library, '.file-seiri'))).toBe(false);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual([]);
    expect(existsSync(join(world.dataDir, 'libraries', 'lib-1'))).toBe(false);
  });

  test('写真が入っているライブラリは、消さない(forget を案内)', async () => {
    const world = await ingested();
    const result = await runIn(world, [
      'library',
      'remove',
      world.library,
      '--yes',
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr.join('\n')).toContain('library forget');
    expect(existsSync(markerPathOf(world.library))).toBe(true);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toHaveLength(1);
  });

  test('ドライブの中身がなくなっても、この Mac の台帳に記録があれば、消さない', async () => {
    const world = await ingested();
    // ドライブの写真だけが、なくなった(目印と管理用のフォルダは、残る)
    for (const name of readdirSync(world.library)) {
      if (name !== '.file-seiri' && name !== '.file-seiri-library.json') {
        rmSync(join(world.library, name), { recursive: true, force: true });
      }
    }
    expect(isEmptyLibrary(world.library)).toBe(true);
    const result = await runIn(world, [
      'library',
      'remove',
      world.library,
      '--yes',
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr.join('\n')).toContain('記録が残っている');
    expect(existsSync(markerPathOf(world.library))).toBe(true);
    expect(existsSync(join(world.dataDir, 'libraries', 'lib-1'))).toBe(true);
  });

  test('forget は、設定から外すだけ。ID の先頭でも、場所でも、指定できる', async () => {
    const world = await ingested();
    registerLibrary(world.dataDir, 'abcdef123456', {
      root: join(world.destDrive, 'Elsewhere'),
      registeredAt: '2026-10-01T00:00:00.000Z',
    });
    const byId = await runIn(world, ['library', 'forget', 'abcd']);
    expect(byId.code).toBe(0);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual(['lib-1']);

    const byPath = await runIn(world, ['library', 'forget', world.library]);
    expect(byPath.code).toBe(0);
    expect(Object.keys(readConfig(world.dataDir).libraries)).toEqual([]);
    // ファイルは、そのまま
    expect(existsSync(markerPathOf(world.library))).toBe(true);

    const missing = await runIn(world, ['library', 'forget', 'zzzz']);
    expect(missing.code).toBe(2);
  });
});
