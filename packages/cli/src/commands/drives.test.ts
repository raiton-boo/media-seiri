import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_CODES } from '../exit-codes.ts';
import { makeVolume } from '../ingest/test-support.ts';
import { writeMarker } from '../library/marker.ts';
import { run } from '../run.ts';
import { makeTempDir } from '../test-helpers.ts';
import { describeKind } from './drives.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const drives = async (
  volumes: ReturnType<typeof makeVolume>[],
  dataDir: string
) => {
  const stdout: string[] = [];
  const code = await run(['--data-dir', dataDir, 'drives'], {
    env: {},
    stdout: (text) => stdout.push(text),
    stderr: () => {},
    listVolumes: () => volumes,
  });
  return { code, text: stdout.join('\n') };
};

describe('drives', () => {
  test('名前・容量・空き・形式・種類・状態・ライブラリを、表にする(日本語の名前でも、そろう)', async () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const photoLib = join(dir, 'PhotoLib');
    mkdirSync(join(photoLib, 'Pictures', '.file-seiri'), { recursive: true });
    writeMarker(join(photoLib, 'Pictures'), {
      libraryId: 'abcdef1234567890',
      createdAt: '2026-10-18T00:00:00.000Z',
      schemaVersion: 2,
    });
    const usb = join(dir, 'USB');
    mkdirSync(usb);

    const result = await drives(
      [
        makeVolume({
          rootPath: '/',
          mountPoint: '/System/Volumes/Data',
          label: 'Macintosh HD - Data',
          fsType: 'apfs',
          isInternal: true,
          mediaKind: 'ssd',
          totalBytes: 994_600_000_000,
          freeBytes: 600_000_000_000,
        }),
        makeVolume({
          rootPath: photoLib,
          label: '写真用',
          fsType: 'exfat',
          totalBytes: 2_000_000_000_000,
          freeBytes: 1_800_000_000_000,
        }),
        makeVolume({
          rootPath: usb,
          label: 'STICK',
          fsType: 'fat32',
          isWritable: false,
          mediaKind: undefined,
          totalBytes: 15_500_000_000,
          freeBytes: 9_600_000_000,
        }),
      ],
      join(dir, 'data')
    );
    expect(result.code).toBe(EXIT_CODES.ok);
    const lines = result.text.split('\n');
    expect(lines[0]).toMatch(
      /^名前\s+容量\s+空き\s+形式\s+種類\s+状態\s+ライブラリ$/
    );
    expect(result.text).toContain('994.6 GB');
    expect(result.text).toContain('内蔵 / SSD');
    expect(result.text).toContain('外付け / USB');
    expect(result.text).toContain('読み取り専用');
    expect(result.text).toContain('書き込み可');
    // ライブラリ: ID の先頭 8 文字・更新なし・場所・この Mac に未登録
    expect(result.text).toContain(
      `abcdef12 (更新なし) ${join(photoLib, 'Pictures')} [この Mac に未登録]`
    );
    expect(result.text).toContain('固有 ID で識別します');
    // 内蔵のデータのボリュームは、根が広すぎるため、ライブラリを探さない
    expect(
      lines
        .find((line) => line.startsWith('Macintosh HD - Data'))
        ?.endsWith('-')
    ).toBe(true);
  });

  test('ドライブがなければ、その旨を表示する。ライブラリが 2 つあれば、続きの行に出す', async () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    expect((await drives([], join(dir, 'data'))).text).toContain(
      '見つかりません'
    );

    const drive = join(dir, 'D');
    for (const [name, id] of [
      ['A', 'aaaaaaaa11'],
      ['B', 'bbbbbbbb22'],
    ] as const) {
      mkdirSync(join(drive, name, '.file-seiri'), { recursive: true });
      writeMarker(join(drive, name), {
        libraryId: id,
        createdAt: '2026-10-18T00:00:00.000Z',
        schemaVersion: 2,
      });
    }
    const result = await drives(
      [makeVolume({ rootPath: drive, label: 'D' })],
      join(dir, 'data')
    );
    expect(result.text).toContain('aaaaaaaa');
    expect(result.text).toContain('bbbbbbbb');
    expect(
      result.text.split('\n').filter((line) => line.includes('bbbbbbbb'))
    ).toHaveLength(1);
  });

  test('余計な引数があれば、使い方の誤り(2)', async () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const code = await run(
      ['--data-dir', join(dir, 'data'), 'drives', 'extra'],
      { env: {}, stdout: () => {}, stderr: () => {} }
    );
    expect(code).toBe(EXIT_CODES.failed);
  });

  test('種類の表示', () => {
    const v = makeVolume({ rootPath: '/x' });
    expect(describeKind({ ...v, isInternal: true, mediaKind: 'ssd' })).toBe(
      '内蔵 / SSD'
    );
    expect(describeKind({ ...v, isInternal: false, mediaKind: 'usb' })).toBe(
      '外付け / USB'
    );
    expect(describeKind({ ...v, isInternal: false, mediaKind: 'hdd' })).toBe(
      '外付け / HDD'
    );
    expect(describeKind({ ...v, isInternal: true, mediaKind: undefined })).toBe(
      '内蔵'
    );
  });
});
