import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizePathInput, PromptCancelled, shellQuote } from '../ask.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  scriptedAsker,
  type World,
} from '../ingest/test-support.ts';
import type { VolumeInfo } from '../volume/index.ts';

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

const interactive = (answers: string[], volumes: VolumeInfo[] = []) => {
  const ask = scriptedAsker(answers);
  return {
    ask,
    options: {
      isInteractive: true,
      ask,
      listVolumes: () => volumes,
      confirm: async () => true,
    },
  };
};

describe('パスの入力の整え方', () => {
  test('ドラッグで入る形(空白の \\・引用符)と、~ を、直す', () => {
    expect(normalizePathInput('/a/b\\ c')).toBe('/a/b c');
    expect(normalizePathInput("'/a/b c'")).toBe('/a/b c');
    expect(normalizePathInput('"/a/b c"')).toBe('/a/b c');
    expect(normalizePathInput('~/Pictures')).toBe(join(homedir(), 'Pictures'));
  });

  test('シェルに貼れる形にする', () => {
    expect(shellQuote('/a/b')).toBe('/a/b');
    expect(shellQuote('/a/b c')).toBe("'/a/b c'");
    expect(shellQuote("/a/it's")).toBe("'/a/it'\\''s'");
  });
});

describe('対話式の取り込み', () => {
  test('取り込み元をたどって選び、保存先は登録済みから選び、結果だけ見る(dry-run)。自分で打つコマンドも出る', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const source: VolumeInfo = {
      ...world.sourceVolume,
      isInternal: false,
      mountPoint: world.srcRoot,
    };
    const { ask, options } = interactive(
      [
        // 外付けのドライブから、始めて、フォルダをたどる
        'Source',
        'DCIM/',
        'ここを選ぶ',
        'これで決める',
        world.library,
        'まず、結果だけ',
      ],
      [source]
    );
    const result = await runIn(world, ['ingest'], options);
    const out = result.stdout.join('\n');
    expect(result.code).toBe(0);
    expect(out).toContain('seiri ingest');
    expect(out).toContain(`--dest ${world.library}`);
    expect(out).toContain('--dry-run');
    // dry-run: コピーされていない
    expect(existsSync(join(world.library, '2024'))).toBe(false);
    expect(ask.asked.length).toBe(6);
  });

  test('取り込む を選ぶと、コピーされる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const { options } = interactive([
      'パスを入力',
      join(world.srcRoot, 'DCIM'),
      'これで決める',
      world.library,
      '取り込む',
    ]);
    const result = await runIn(world, ['ingest'], options);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain('コピー済み');
  });

  test('引数で、取り込み元・保存先を決めてあれば、聞かない(従来どおり)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const { ask, options } = interactive([]);
    const result = await runIn(
      world,
      [
        'ingest',
        join(world.srcRoot, 'DCIM'),
        '--dest',
        world.library,
        '--dry-run',
      ],
      options
    );
    expect(result.code).toBe(0);
    expect(ask.asked).toEqual([]);
  });

  test('保存先だけ足りないときは、保存先だけ聞く', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const { ask, options } = interactive([world.library, 'まず、結果だけ']);
    const result = await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM')],
      options
    );
    expect(result.code).toBe(0);
    expect(ask.asked.length).toBe(2);
  });

  test('やめる を選ぶと、何もせず、終わる', async () => {
    const world = await newWorld();
    const { options } = interactive([
      'パスを入力',
      world.srcRoot,
      'これで決める',
      world.library,
      'やめる',
    ]);
    const result = await runIn(world, ['ingest'], options);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain('やめました');
  });

  test('途中で中止(Ctrl-C・q)すると、130', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['ingest'], {
      isInteractive: true,
      listVolumes: () => [],
      ask: {
        select: async () => {
          throw new PromptCancelled();
        },
        text: async () => '',
      },
    });
    expect(result.code).toBe(130);
    expect(result.stderr.join('\n')).toContain('中止しました');
  });

  test('端末でないときは、聞かずに、使い方を出して失敗(2)', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['ingest']);
    expect(result.code).toBe(2);
    expect(result.stderr.join('\n')).toContain('使い方');
  });

  test('新しいライブラリを、選びながら作れる', async () => {
    const world = makeWorld();
    worlds.push(world);
    const fresh = join(world.destDrive, 'NewPictures');
    mkdirSync(world.destDrive, { recursive: true });
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const { options } = interactive([
      '新しくライブラリを作る',
      'パスを入力',
      fresh,
      'まず、結果だけ',
    ]);
    const result = await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM')],
      options
    );
    expect(result.code).toBe(0);
    expect(existsSync(join(fresh, '.file-seiri-library.json'))).toBe(true);
  });
});

describe('入口のメニュー', () => {
  test('端末で、コマンドなしなら、メニューが出て、選んだコマンドを実行する', async () => {
    const world = await newWorld();
    const { ask, options } = interactive(['状況']);
    const result = await runIn(world, [], options);
    expect(result.code).toBe(0);
    expect(ask.asked[0]).toBe('何をしますか?');
  });

  test('やめる を選ぶと、0', async () => {
    const world = await newWorld();
    const { options } = interactive(['やめる']);
    const result = await runIn(world, [], options);
    expect(result.code).toBe(0);
  });
});
