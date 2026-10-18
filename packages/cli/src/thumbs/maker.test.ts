import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir } from '../test-helpers.ts';
import {
  createThumbnailMaker,
  THUMBNAIL_MAX_EDGE,
  type ThumbnailMaker,
} from './maker.ts';

/** sips・ffmpeg は、macOS の本機の道具。ない環境では、飛ばす */
const hasTools =
  process.platform === 'darwin' &&
  Bun.which('sips') !== null &&
  Bun.which('ffmpeg') !== null &&
  Bun.which('ffprobe') !== null;

const run = (command: string[]): void => {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} が失敗: ${result.stderr.toString()}`);
  }
};

/** 画像の幅・高さ(sips で読む) */
const sizeOf = (path: string): { width: number; height: number } => {
  const result = Bun.spawnSync(
    ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
    { stdout: 'pipe' }
  );
  const text = result.stdout.toString();
  return {
    width: Number(/pixelWidth: (\d+)/.exec(text)?.[1]),
    height: Number(/pixelHeight: (\d+)/.exec(text)?.[1]),
  };
};

describe.skipIf(!hasTools)('サムネイルを作る(本物の sips・ffmpeg)', () => {
  let dir = '';
  let cleanup = (): void => {};
  let maker: ThumbnailMaker;
  const path = (name: string): string => join(dir, name);

  beforeAll(() => {
    ({ dir, cleanup } = makeTempDir());
    mkdirSync(join(dir, 'out'));
    maker = createThumbnailMaker();
    run([
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1200x800:rate=1',
      '-frames:v',
      '1',
      path('big.jpg'),
    ]);
    run([
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=100x60:rate=1',
      '-frames:v',
      '1',
      path('small.jpg'),
    ]);
    run([
      'sips',
      '-s',
      'format',
      'heic',
      path('big.jpg'),
      '--out',
      path('big.heic'),
    ]);
    run([
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=10:duration=3',
      '-pix_fmt',
      'yuv420p',
      path('video.mp4'),
    ]);
    // 0.3 秒の動画: 長さの 10% の位置(0.03 秒)でも取れる。長さが読めなくても、最初の 1 コマで取れる
    run([
      'ffmpeg',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x240:rate=10:duration=0.3',
      '-pix_fmt',
      'yuv420p',
      path('short.mp4'),
    ]);
    writeFileSync(path('broken.jpg'), 'これは画像ではありません');
    writeFileSync(path('broken.mp4'), 'これは動画ではありません');
  });
  afterAll(async () => {
    await maker.close();
    cleanup();
  });

  const make = async (
    kind: 'photo' | 'raw' | 'video',
    name: string
  ): Promise<string> => {
    const outputPath = path(`out/${name}.jpg`);
    await maker.make({ kind, sourcePath: path(name), outputPath });
    return outputPath;
  };

  test('大きい写真は、長辺を 400 に縮める', async () => {
    const out = await make('photo', 'big.jpg');
    const { width, height } = sizeOf(out);
    expect(Math.max(width, height)).toBe(THUMBNAIL_MAX_EDGE);
    expect(width).toBeGreaterThan(height);
  });

  test('小さい写真は、拡大しない', async () => {
    const out = await make('photo', 'small.jpg');
    expect(sizeOf(out)).toEqual({ width: 100, height: 60 });
  });

  test('HEIC は、JPEG に変換する', async () => {
    const out = await make('photo', 'big.heic');
    expect(Math.max(sizeOf(out).width, sizeOf(out).height)).toBe(
      THUMBNAIL_MAX_EDGE
    );
  });

  test('動画は、代表の 1 コマを JPEG にする(元より大きくはしない)', async () => {
    const out = await make('video', 'video.mp4');
    expect(sizeOf(out)).toEqual({ width: 400, height: 226 });
    const short = await make('video', 'short.mp4');
    expect(sizeOf(short)).toEqual({ width: 320, height: 240 });
  });

  test('壊れた写真・動画は、理由つきで失敗し、出力を残さない', async () => {
    await expect(make('photo', 'broken.jpg')).rejects.toThrow();
    await expect(make('video', 'broken.mp4')).rejects.toThrow();
    expect(existsSync(path('out/broken.jpg.jpg'))).toBe(false);
  });

  test('RAW でないものを RAW として渡すと、プレビューがなく、失敗する(一時ファイルを残さない)', async () => {
    await expect(make('raw', 'big.jpg')).rejects.toThrow();
    expect(existsSync(path('out/big.jpg.jpg.preview'))).toBe(false);
    rmSync(path('out/big.jpg.jpg'), { force: true });
  });
});
