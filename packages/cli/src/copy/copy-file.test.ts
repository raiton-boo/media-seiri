import { afterEach, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { SourceChangedError } from '../hash/index.ts';
import { makeTempDir } from '../test-helpers.ts';
import { copyVerified, partPathOf } from './copy-file.ts';
import { CopyError, DestinationExistsError } from './errors.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const OLD_MTIME_MS = 946_684_800_000; // 2000-01-01
const sha256 = (data: string | Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(data).digest('hex');

/** ソース(更新日は、2000 年)と、保存先のフォルダを作る */
const setup = (content: string | Uint8Array = 'hello') => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'lib'));
  const sourcePath = join(dir, 'src', 'IMG_0001.JPG');
  writeFileSync(sourcePath, content);
  utimesSync(sourcePath, OLD_MTIME_MS / 1000, OLD_MTIME_MS / 1000);
  const destinationPath = join(
    dir,
    'lib',
    '2024',
    '03',
    '20240305_IMG_0001.jpg'
  );
  const size =
    typeof content === 'string' ? Buffer.byteLength(content) : content.length;
  const request = {
    sourcePath,
    destinationPath,
    expected: { sizeBytes: size, mtimeMs: OLD_MTIME_MS },
    removeAppleDouble: false,
  };
  const libraryFiles = (): string[] =>
    existsSync(join(dir, 'lib'))
      ? readdirSync(join(dir, 'lib'), { recursive: true }).map(String).sort()
      : [];
  return { dir, sourcePath, destinationPath, request, libraryFiles };
};

describe.skipIf(process.platform !== 'darwin')('copyVerified', () => {
  test('コピーして、ソースのハッシュを返す。保存先は同じ中身で、一時ファイルは残らない', async () => {
    const { request, destinationPath, libraryFiles } = setup('hello');
    const result = await copyVerified(request);
    expect(result).toEqual({ hash: sha256('hello'), sizeBytes: 5 });
    expect(readFileSync(destinationPath, 'utf8')).toBe('hello');
    // 保存先のフォルダ(2024/03)も、作られる
    expect(libraryFiles()).toEqual([
      '2024',
      '2024/03',
      '2024/03/20240305_IMG_0001.jpg',
    ]);
  });

  test('複数のチャンクにまたがるファイル(小さなチャンクで)も、同じ中身', async () => {
    const bytes = new Uint8Array(1_000_003).map(
      (_, index) => (index * 31) % 251
    );
    const { request, destinationPath } = setup(bytes);
    const result = await copyVerified({ ...request, chunkBytes: 64 * 1024 });
    expect(result).toEqual({ hash: sha256(bytes), sizeBytes: bytes.length });
    expect(
      Buffer.compare(readFileSync(destinationPath), Buffer.from(bytes))
    ).toBe(0);
  });

  test('空のファイルも、コピーできる', async () => {
    const { request, destinationPath } = setup('');
    expect(await copyVerified(request)).toEqual({
      hash: sha256(''),
      sizeBytes: 0,
    });
    expect(statSync(destinationPath).size).toBe(0);
  });

  test('更新日は、引き継がない(コピーした時刻)。ソースは、変わらない', async () => {
    const { request, destinationPath, sourcePath } = setup('hello');
    const before = Date.now();
    await copyVerified(request);
    expect(statSync(destinationPath).mtimeMs).toBeGreaterThanOrEqual(
      before - 2000
    );
    expect(statSync(sourcePath).mtimeMs).toBe(OLD_MTIME_MS);
    expect(readFileSync(sourcePath, 'utf8')).toBe('hello');
  });

  test('事前に知っているハッシュが一致していれば、コピーできる', async () => {
    const { request } = setup('hello');
    await expect(
      copyVerified({
        ...request,
        expected: { ...request.expected, hash: sha256('hello') },
      })
    ).resolves.toBeDefined();
  });

  test('保存先に書いたあとで中身が違えば、HASH_MISMATCH。一時ファイルを消し、正式名にしない', async () => {
    const { request, destinationPath, libraryFiles } = setup('hello world');
    const error = await copyVerified({
      ...request,
      hooks: {
        // 書いたあとで、保存先のビットが化けた(1 バイトを書き換える)
        afterSync: ({ partPath }) => {
          const bytes = readFileSync(partPath);
          bytes[3] = (bytes[3] ?? 0) ^ 0xff;
          writeFileSync(partPath, bytes);
        },
      },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(CopyError);
    expect((error as CopyError).code).toBe('HASH_MISMATCH');
    expect(existsSync(destinationPath)).toBe(false);
    expect(libraryFiles().filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  test('同名がすでにあれば、上書きせず DestinationExistsError。既存は無事で、一時ファイルは残らない', async () => {
    const { request, destinationPath, libraryFiles } = setup('new content');
    mkdirSync(join(destinationPath, '..'), { recursive: true });
    writeFileSync(destinationPath, 'existing');
    await expect(copyVerified(request)).rejects.toBeInstanceOf(
      DestinationExistsError
    );
    expect(readFileSync(destinationPath, 'utf8')).toBe('existing');
    expect(libraryFiles().filter((name) => name.includes('.part'))).toEqual([]);
  });

  test('前の実行の一時ファイルが残っていれば、上書きせず、COPY_FAILED(掃除は、起動時に行う)', async () => {
    const { request, destinationPath } = setup('hello');
    mkdirSync(join(destinationPath, '..'), { recursive: true });
    writeFileSync(partPathOf(destinationPath), 'leftover');
    const error = await copyVerified(request).catch((e) => e);
    expect((error as CopyError).code).toBe('COPY_FAILED');
    // 残っていた一時ファイルは、この実行のものではないので、消さない
    expect(readFileSync(partPathOf(destinationPath), 'utf8')).toBe('leftover');
  });

  test('ソースが、コピーの間に書き換えられたら、SourceChangedError。何も残さない', async () => {
    const { request, destinationPath, libraryFiles } = setup('hello');
    await expect(
      copyVerified({
        ...request,
        hooks: {
          afterSync: ({ sourcePath }) => appendFileSync(sourcePath, '!'),
        },
      })
    ).rejects.toBeInstanceOf(SourceChangedError);
    expect(existsSync(destinationPath)).toBe(false);
    expect(libraryFiles().filter((name) => name.includes('.part'))).toEqual([]);
  });

  test('事前のサイズ・ハッシュと違えば、SourceChangedError', async () => {
    const { request, destinationPath } = setup('hello');
    await expect(
      copyVerified({
        ...request,
        expected: { ...request.expected, sizeBytes: 999 },
      })
    ).rejects.toBeInstanceOf(SourceChangedError);
    await expect(
      copyVerified({
        ...request,
        expected: { ...request.expected, hash: sha256('other') },
      })
    ).rejects.toBeInstanceOf(SourceChangedError);
    await expect(
      copyVerified({
        ...request,
        expected: { ...request.expected, mtimeMs: OLD_MTIME_MS + 5000 },
      })
    ).rejects.toBeInstanceOf(SourceChangedError);
    expect(existsSync(destinationPath)).toBe(false);
  });

  test('ソースが読めなければ、READ_FAILED(保存先に、何も作らない)', async () => {
    const { request, destinationPath } = setup('hello');
    const missing = await copyVerified({
      ...request,
      sourcePath: join(request.sourcePath, '..', 'none.jpg'),
    }).catch((e) => e);
    expect((missing as CopyError).code).toBe('READ_FAILED');
    expect(existsSync(partPathOf(destinationPath))).toBe(false);
    chmodSync(request.sourcePath, 0o000);
    try {
      const locked = await copyVerified(request).catch((e) => e);
      expect((locked as CopyError).code).toBe('READ_FAILED');
    } finally {
      chmodSync(request.sourcePath, 0o644);
    }
  });

  test('書き込みに失敗したら(容量不足など)、COPY_FAILED。一時ファイルを消す', async () => {
    const { request, destinationPath, libraryFiles } = setup('hello');
    const error = await copyVerified({
      ...request,
      hooks: {
        afterChunkWritten: () => {
          throw Object.assign(new Error('no space left on device'), {
            code: 'ENOSPC',
          });
        },
      },
    }).catch((e) => e);
    expect((error as CopyError).code).toBe('COPY_FAILED');
    expect(((error as CopyError).cause as { code?: string }).code).toBe(
      'ENOSPC'
    );
    expect(existsSync(destinationPath)).toBe(false);
    expect(libraryFiles().filter((name) => name.includes('.part'))).toEqual([]);
  });

  test('保存先のフォルダに書けなければ、COPY_FAILED', async () => {
    const { request, dir } = setup('hello');
    chmodSync(join(dir, 'lib'), 0o555);
    try {
      const error = await copyVerified(request).catch((e) => e);
      expect((error as CopyError).code).toBe('COPY_FAILED');
    } finally {
      chmodSync(join(dir, 'lib'), 0o755);
    }
  });

  test('removeAppleDouble: 正式名にしたあとに作られた付属ファイル(._名前)を、消す', async () => {
    const { request, destinationPath, libraryFiles } = setup('hello');
    await copyVerified({
      ...request,
      removeAppleDouble: true,
      hooks: {
        afterRename: (path) => {
          // macOS が、exFAT に作る付属ファイルの再現
          writeFileSync(
            join(path, '..', `._${path.split('/').pop()}`),
            'apple-double'
          );
        },
      },
    });
    expect(libraryFiles()).toEqual([
      '2024',
      '2024/03',
      '2024/03/20240305_IMG_0001.jpg',
    ]);
    expect(readFileSync(destinationPath, 'utf8')).toBe('hello');
  });

  test('removeAppleDouble が false なら、付属ファイルには、触らない', async () => {
    const { request, libraryFiles } = setup('hello');
    await copyVerified({
      ...request,
      removeAppleDouble: false,
      hooks: {
        afterRename: (path) =>
          writeFileSync(join(path, '..', '._20240305_IMG_0001.jpg'), 'x'),
      },
    });
    expect(libraryFiles()).toContain('2024/03/._20240305_IMG_0001.jpg');
  });

  test('日本語・空白を含む名前でも、コピーできる', async () => {
    const { request, dir } = setup('hello');
    const destinationPath = join(
      dir,
      'lib',
      '2024',
      '03',
      '2024.03.05_12-30-45_写真 1.jpg'
    );
    await copyVerified({ ...request, destinationPath });
    expect(readFileSync(destinationPath, 'utf8')).toBe('hello');
  });

  test('同時に、たくさんコピーできる(それぞれ、正しい中身)', async () => {
    const { dir } = setup('x');
    const jobs = Array.from({ length: 12 }, async (_, index) => {
      const sourcePath = join(dir, 'src', `f${index}.jpg`);
      const content = `content-${index}-${'x'.repeat(index * 1000)}`;
      writeFileSync(sourcePath, content);
      const mtimeMs = statSync(sourcePath).mtimeMs;
      const destinationPath = join(dir, 'lib', `out${index}.jpg`);
      const result = await copyVerified({
        sourcePath,
        destinationPath,
        expected: { sizeBytes: Buffer.byteLength(content), mtimeMs },
        removeAppleDouble: false,
        chunkBytes: 4096,
      });
      return { result, destinationPath, content };
    });
    for (const { result, destinationPath, content } of await Promise.all(
      jobs
    )) {
      expect(result.hash).toBe(sha256(content));
      expect(readFileSync(destinationPath, 'utf8')).toBe(content);
    }
  });
});

describe('partPathOf', () => {
  test('同じフォルダの .<名前>.part', () => {
    expect(partPathOf('/lib/2024/03/a.jpg')).toBe('/lib/2024/03/.a.jpg.part');
  });
});
