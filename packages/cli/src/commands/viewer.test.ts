import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DashboardResponse } from '@file-seiri/viewer';
import { EXIT_CODES } from '../exit-codes.ts';
import {
  addPhoto,
  DATE_2024_03_05,
  fakeThumbnailMaker,
  initLibrary,
  installExifWriter,
  makeWorld,
  NOW,
  runIn,
  type World,
} from '../ingest/test-support.ts';
import { run } from '../run.ts';

installExifWriter();

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const newWorld = async (): Promise<World> => {
  const world = makeWorld();
  cleanups.push(world.cleanup);
  await initLibrary(world);
  return world;
};

const makeWebDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-web-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index.html'), '<h1>viewer</h1>');
  return dir;
};

/** `viewer` を起動し、`work` を実行してから、止める(Ctrl-C の代わり)。標準出力の行も返す */
const withViewer = async (
  world: World,
  extraArgs: string[],
  work: (url: string) => Promise<void>,
  webDir = makeWebDir(),
  options: { interactive?: boolean; opened?: string[] } = {}
): Promise<{ code: number; stdout: string[]; stderr: string[] }> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let stop = false;
  const finished = run(
    ['--data-dir', world.dataDir, 'viewer', '--port', '0', ...extraArgs],
    {
      env: {},
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      now: () => NOW,
      timeZone: 'Asia/Tokyo',
      isInteractive: options.interactive ?? false,
      openBrowser: (url) => options.opened?.push(url),
      resolveVolume: () => world.destVolume,
      shouldStop: () => stop,
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      viewerWebDir: webDir,
    }
  );
  // 起動の表示(URL)が出るまで待つ
  const started = async (): Promise<string> => {
    for (let waited = 0; waited < 5000; waited += 20) {
      const line = stdout.find((text) => text.includes('http://127.0.0.1:'));
      if (line) return /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(line)?.[1] ?? '';
      if (stderr.length > 0) return '';
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return '';
  };
  const url = await started();
  try {
    if (url) await work(url);
  } finally {
    stop = true;
  }
  return { ...(await finished.then((code) => ({ code }))), stdout, stderr };
};

describe('viewer', () => {
  test('取り込み済みのライブラリを、この Mac の台帳で配信する(API・画面・サムネイル)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, '--yes'],
      { thumbnailMaker: () => fakeThumbnailMaker() }
    );
    const result = await withViewer(
      world,
      ['--library', world.library],
      async (url) => {
        const dashboard = (await (
          await fetch(`${url}api/dashboard`)
        ).json()) as DashboardResponse;
        expect(dashboard.source).toBe('working');
        expect(dashboard.library).toMatchObject({
          name: 'Library',
          fsType: 'exfat',
        });
        expect(dashboard.summary.files.photos).toBe(1);
        expect(dashboard.runs).toHaveLength(1);
        expect(dashboard.disk?.totalBytes).toBeGreaterThan(0);
        expect(await (await fetch(url)).text()).toBe('<h1>viewer</h1>');
        // サムネイルは、data/ の正本から返る
        const hash = (
          await import('@file-seiri/ledger').then(({ openLedger }) => {
            const ledger = openLedger(
              join(world.dataDir, 'libraries', 'lib-1', 'catalog.sqlite'),
              { mode: 'readonly' }
            );
            try {
              return ledger.db
                .query<{ hash: string }, []>('SELECT hash FROM contents')
                .get() as { hash: string };
            } finally {
              ledger.close();
            }
          })
        ).hash;
        const thumb = await fetch(
          `${url}api/thumbs/${hash.slice(0, 2)}/${hash}.jpg`
        );
        expect(thumb.status).toBe(200);
      }
    );
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('この Mac の台帳');
  });

  test('端末では、ブラウザを自動で開く。--no-open・端末でないときは、開かない', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, '--yes'],
      { thumbnailMaker: () => fakeThumbnailMaker() }
    );
    const opened: string[] = [];
    await withViewer(world, [], async () => {}, makeWebDir(), {
      interactive: true,
      opened,
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const noOpen: string[] = [];
    await withViewer(world, ['--no-open'], async () => {}, makeWebDir(), {
      interactive: true,
      opened: noOpen,
    });
    expect(noOpen).toEqual([]);

    const notTerminal: string[] = [];
    await withViewer(world, [], async () => {}, makeWebDir(), {
      interactive: false,
      opened: notTerminal,
    });
    expect(notTerminal).toEqual([]);
  });

  /** 取り込み済みの世界で、2 つ目の `viewer` を、同じポートで動かす(1 つ目は、動いたまま) */
  const secondViewer = async (
    occupy: 'viewer' | 'other'
  ): Promise<{
    code: number;
    stdout: string[];
    stderr: string[];
    opened: string[];
    first: string;
  }> => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await runIn(
      world,
      ['ingest', join(world.srcRoot, 'DCIM'), '--dest', world.library, '--yes'],
      { thumbnailMaker: () => fakeThumbnailMaker() }
    );
    const opened: string[] = [];
    const result = { code: -1, stdout: [] as string[], stderr: [] as string[] };
    let first = '';
    const second = async (port: number): Promise<void> => {
      result.code = await run(
        [
          '--data-dir',
          world.dataDir,
          'viewer',
          '--library',
          world.library,
          '--port',
          String(port),
        ],
        {
          env: {},
          stdout: (text) => result.stdout.push(text),
          stderr: (text) => result.stderr.push(text),
          now: () => NOW,
          timeZone: 'Asia/Tokyo',
          isInteractive: true,
          openBrowser: (url) => opened.push(url),
          resolveVolume: () => world.destVolume,
          shouldStop: () => true,
          sleep: async () => {},
          viewerWebDir: makeWebDir(),
        }
      );
    };
    if (occupy === 'viewer') {
      await withViewer(world, ['--library', world.library], async (url) => {
        first = url;
        await second(Number(new URL(url).port));
      });
    } else {
      const occupant = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response('other'),
      });
      try {
        await second(occupant.port ?? 0);
      } finally {
        occupant.stop(true);
      }
    }
    return { ...result, opened, first };
  };

  test('すでに同じライブラリのビューアが動いていれば、起動せず、そのアドレスを開く(エラーにしない)', async () => {
    const result = await secondViewer('viewer');
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('すでに起動しています');
    expect(result.opened).toEqual([result.first]);
  });

  test('ポートを、ほかのプログラムが使っているときは、--port を指定していれば、わかる言葉で、止まる', async () => {
    const result = await secondViewer('other');
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain(
      'ほかのプログラムが使っています'
    );
    expect(result.opened).toEqual([]);
  });

  test('--snapshot: ライブラリのスナップショットを開く(家の PC と同じ見え方)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ]);
    const result = await withViewer(
      world,
      ['--library', world.library, '--snapshot'],
      async (url) => {
        const dashboard = (await (
          await fetch(`${url}api/dashboard`)
        ).json()) as DashboardResponse;
        expect(dashboard.source).toBe('snapshot');
        expect(dashboard.running).toBeNull();
        expect(dashboard.summary.files.total).toBe(1);
      }
    );
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('スナップショット');
  });

  test('台帳が古い版のときは、読み取り専用では移行できないため、直し方を案内して、止まる', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', DATE_2024_03_05);
    await runIn(world, [
      'ingest',
      join(world.srcRoot, 'DCIM'),
      '--dest',
      world.library,
      '--yes',
    ]);
    const { Database } = await import('bun:sqlite');
    const raw = new Database(
      join(world.dataDir, 'libraries', 'lib-1', 'catalog.sqlite')
    );
    raw.exec('PRAGMA user_version = 1');
    raw.close();
    const result = await runIn(world, ['viewer', '--library', world.library], {
      viewerWebDir: makeWebDir(),
    });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('verify・thumbs・ingest');
  });

  test('画面が作られていなければ、作り方を案内して、止まる', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['viewer', '--library', world.library], {
      viewerWebDir: join(world.base, 'no-such-dir'),
    });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('build:web');
  });

  test('台帳もスナップショットもなければ、止まる。--port が不正でも、止まる', async () => {
    const world = await newWorld();
    mkdirSync(join(world.base, 'empty-lib'));
    const webDir = makeWebDir();
    // 取り込み前: スナップショットが、まだない
    const noSnapshot = await runIn(
      world,
      ['viewer', '--library', world.library, '--snapshot'],
      { viewerWebDir: webDir }
    );
    expect(noSnapshot.code).toBe(EXIT_CODES.failed);
    expect(noSnapshot.stderr.join('\n')).toContain(
      'スナップショットがありません'
    );
    // ライブラリではない場所
    const notLibrary = await runIn(
      world,
      ['viewer', '--library', join(world.base, 'empty-lib')],
      { viewerWebDir: webDir }
    );
    expect(notLibrary.code).toBe(EXIT_CODES.failed);
    const badPort = await runIn(
      world,
      ['viewer', '--library', world.library, '--port', 'abc'],
      { viewerWebDir: webDir }
    );
    expect(badPort.code).toBe(EXIT_CODES.failed);
    expect(badPort.stderr.join('\n')).toContain('--port');
  });
});
