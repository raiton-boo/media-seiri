import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  scriptedAsker,
  type World,
} from '../ingest/test-support.ts';
import { makeTempDir } from '../test-helpers.ts';
import { installViewerBundle, VIEWER_FILES } from '../viewer-bundle/install.ts';
import { locateLibraries } from './locate.ts';
import { browserCommand, openBrowser } from './open-browser.ts';
import {
  mainStandaloneViewer,
  runStandaloneViewer,
  type StandaloneEnvironment,
} from './run.ts';

installExifWriter();

const worlds: World[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 写真を 1 枚取り込み済みの世界(スナップショットも、できている) */
const ingestedWorld = async (): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
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

const tempDir = (): string => {
  const temp = makeTempDir();
  cleanups.push(temp.cleanup);
  return temp.dir;
};

describe('ライブラリを、実行ファイルの置き場所から探す', () => {
  const library = (root: string): void => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '.file-seiri-library.json'), '{}');
  };

  test('<ライブラリ>/viewer/ に置けば、1 つ上のライブラリ', () => {
    const drive = tempDir();
    library(join(drive, 'Pictures'));
    mkdirSync(join(drive, 'Pictures', 'viewer'));
    const found = locateLibraries(join(drive, 'Pictures', 'viewer'));
    expect(found.map((item) => item.root)).toEqual([join(drive, 'Pictures')]);
  });

  test('<ドライブ>/viewer/ に置けば、ドライブの直下のライブラリ(複数なら、すべて)。隠しフォルダは、見ない', () => {
    const drive = tempDir();
    library(join(drive, 'Pictures'));
    library(join(drive, 'Family'));
    library(join(drive, '.hidden'));
    mkdirSync(join(drive, 'viewer'));
    const found = locateLibraries(join(drive, 'viewer')).map(
      (item) => item.root
    );
    expect(found.sort()).toEqual(
      [join(drive, 'Family'), join(drive, 'Pictures')].sort()
    );
  });

  test('なければ、空', () => {
    const drive = tempDir();
    mkdirSync(join(drive, 'viewer'));
    expect(locateLibraries(join(drive, 'viewer'))).toEqual([]);
  });
});

describe('ブラウザを開く', () => {
  test('OS ごとのコマンド', () => {
    expect(browserCommand('win32', 'http://x/')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://x/'],
    });
    expect(browserCommand('darwin', 'http://x/').command).toBe('open');
    expect(browserCommand('linux', 'http://x/').command).toBe('xdg-open');
    const calls: string[][] = [];
    openBrowser('http://x/', 'darwin', (command, args) =>
      calls.push([command, ...args])
    );
    expect(calls).toEqual([['open', 'http://x/']]);
  });
});

describe('閲覧専用ビューア(単体)', () => {
  const environmentFor = (
    world: World,
    overrides: Partial<StandaloneEnvironment> = {}
  ) => {
    const printed: string[] = [];
    const opened: string[] = [];
    const seen: { info?: unknown; status?: number } = {};
    const environment: StandaloneEnvironment = {
      startDirectory: join(world.library, 'viewer'),
      print: (text) => printed.push(text),
      ask: scriptedAsker([]),
      open: (url) => opened.push(url),
      // 動いている間に、実際に、つないで確かめる
      waitForStop: async () => {
        const url = /http:\/\/\S+\//.exec(printed.join('\n'))?.[0];
        if (url) {
          seen.info = await (await fetch(`${url}api/info`)).json();
          seen.status = (await fetch(`${url}album`)).status;
        }
      },
      now: () => new Date(),
      pause: async () => {},
      platform: 'win32',
      webDir: tempDir(),
      ...overrides,
    };
    return { environment, printed, opened, seen };
  };

  test('スナップショットを開き、アドレスを出して、ブラウザを開く。Mac の情報(ドライブの種類など)は、使わない', async () => {
    const world = await ingestedWorld();
    writeFileSync(join(tempDir(), 'x'), '');
    const { environment, printed, opened, seen } = environmentFor(world);
    writeFileSync(join(environment.webDir, 'album.html'), 'album');
    const code = await runStandaloneViewer(['--port', '0'], environment);
    expect(code).toBe(0);
    expect(printed.join('\n')).toContain('ビューアを起動しました');
    expect(opened).toHaveLength(1);
    expect(seen.info).toMatchObject({
      source: 'snapshot',
      libraryConnected: true,
      library: { fsType: null, mediaKind: null },
    });
    expect(seen.status).toBe(200);
  });

  test('--no-open なら、ブラウザを開かない。古いスナップショットには、注意を添える', async () => {
    const world = await ingestedWorld();
    const { environment, printed, opened } = environmentFor(world, {
      now: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
    expect(
      await runStandaloneViewer(['--no-open', '--port', '0'], environment)
    ).toBe(0);
    expect(opened).toEqual([]);
    expect(printed.join('\n')).toContain('古い内容です');
  });

  test('既定のポートが使用中なら、空いているポートを選ぶ', async () => {
    const world = await ingestedWorld();
    const occupied = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('x'),
    });
    try {
      const { environment, printed } = environmentFor(world);
      await runStandaloneViewer(['--port', String(occupied.port)], environment);
      const url = /http:\/\/\S+\//.exec(printed.join('\n'))?.[0] ?? '';
      expect(url).not.toContain(`:${occupied.port}/`);
      expect(url).toContain('http://127.0.0.1:');
    } finally {
      occupied.stop(true);
    }
  });

  test('ライブラリが複数あれば、選んでもらう', async () => {
    const world = await ingestedWorld();
    // 同じドライブの、もう 1 つのライブラリ(スナップショットなし)
    const second = join(world.destDrive, 'Second');
    expect(
      (
        await runIn(world, ['library', 'init', second], {
          newLibraryId: () => 'lib-2',
        })
      ).code
    ).toBe(0);
    const ask = scriptedAsker([world.library]);
    const { environment } = environmentFor(world, {
      startDirectory: join(world.destDrive, 'viewer'),
      ask,
    });
    mkdirSync(join(world.destDrive, 'viewer'), { recursive: true });
    expect(
      await runStandaloneViewer(['--no-open', '--port', '0'], environment)
    ).toBe(0);
    expect(ask.asked).toHaveLength(1);
  });

  test('ライブラリが見つからない・スナップショットがないときは、わかる言葉で、失敗(2)', async () => {
    const world = makeWorld();
    worlds.push(world);
    const empty = environmentFor(world, { startDirectory: tempDir() });
    expect(await mainStandaloneViewer([], empty.environment)).toBe(2);
    expect(empty.printed.join('\n')).toContain('ライブラリが見つかりません');

    await initLibrary(world); // 目印はあるが、取り込んでいない(スナップショットなし)
    const none = environmentFor(world, {
      startDirectory: join(world.library, 'viewer'),
    });
    expect(await mainStandaloneViewer([], none.environment)).toBe(2);
    expect(none.printed.join('\n')).toContain('スナップショットがありません');
  });

  test('--help は、説明を出して、0', async () => {
    const world = makeWorld();
    worlds.push(world);
    const { environment, printed } = environmentFor(world);
    expect(await runStandaloneViewer(['--help'], environment)).toBe(0);
    expect(printed.join('\n')).toContain('--library');
  });
});

describe('ドライブへのビューアの設置', () => {
  /** ビューアの一式の代わり(中身は、ダミー) */
  const bundle = (names: readonly string[] = VIEWER_FILES): string => {
    const dir = tempDir();
    for (const name of names) writeFileSync(join(dir, name), `dummy-${name}`);
    return dir;
  };

  test('viewer/ に置き、説明(README.txt)も書く。2 回目は、置き直さない。版が変われば、置き換える', () => {
    const library = tempDir();
    const bundleDir = bundle();
    const first = installViewerBundle({
      bundleDir,
      libraryRoot: library,
      version: '1.0.0',
    });
    expect(first?.installed).toHaveLength(VIEWER_FILES.length);
    expect(existsSync(join(library, 'viewer', 'README.txt'))).toBe(true);
    expect(readFileSync(join(library, 'viewer', VIEWER_FILES[0]), 'utf8')).toBe(
      `dummy-${VIEWER_FILES[0]}`
    );

    const second = installViewerBundle({
      bundleDir,
      libraryRoot: library,
      version: '1.0.0',
    });
    expect(second?.installed).toEqual([]);
    expect(second?.unchanged).toHaveLength(VIEWER_FILES.length);

    const third = installViewerBundle({
      bundleDir,
      libraryRoot: library,
      version: '2.0.0',
    });
    expect(third?.installed).toHaveLength(VIEWER_FILES.length);
  });

  test('一式の一部がなければ、ないものを知らせる。一式のフォルダがなければ、何もしない', () => {
    const library = tempDir();
    const partial = installViewerBundle({
      bundleDir: bundle([VIEWER_FILES[0]]),
      libraryRoot: library,
      version: '1',
    });
    expect(partial?.installed).toEqual([VIEWER_FILES[0]]);
    expect(partial?.missing).toHaveLength(VIEWER_FILES.length - 1);

    const other = tempDir();
    expect(
      installViewerBundle({
        bundleDir: join(other, 'nothing'),
        libraryRoot: other,
        version: '1',
      })
    ).toBeUndefined();
    rmSync(other, { recursive: true, force: true });
  });

  test('本実行の取り込みの最後に、ドライブへ置く。dry-run では、置かない', async () => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const bundleDir = bundle();
    const args = [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ];

    const dry = await runIn(world, [...args, '--dry-run'], {
      viewerBundleDir: bundleDir,
    });
    expect(dry.code).toBe(0);
    expect(existsSync(join(world.library, 'viewer'))).toBe(false);

    const real = await runIn(world, args, { viewerBundleDir: bundleDir });
    expect(real.code).toBe(0);
    expect(real.stdout.join('\n')).toContain(
      'ビューアを、ドライブに置きました'
    );
    expect(existsSync(join(world.library, 'viewer', VIEWER_FILES[0]))).toBe(
      true
    );
  });

  test('viewer-install コマンドで、いつでも置ける。一式がなければ、置き場所を案内して失敗', async () => {
    const world = makeWorld();
    worlds.push(world);
    await initLibrary(world);
    const ok = await runIn(world, ['viewer-install'], {
      viewerBundleDir: bundle(),
    });
    expect(ok.code).toBe(0);
    expect(existsSync(join(world.library, 'viewer', 'README.txt'))).toBe(true);

    const missing = await runIn(world, ['viewer-install'], {
      viewerBundleDir: join(tempDir(), 'nothing'),
    });
    expect(missing.code).toBe(2);
    expect(missing.stderr.join('\n')).toContain('build:viewers');
  });
});
