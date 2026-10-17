import {
  closeSync,
  fsyncSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import {
  CHUNK_SIZE,
  disableCache,
  GIB,
  megabytesPerSecond,
  prepareTempDirectory,
  removeSidecar,
  removeTempDirectory,
} from './shared.ts';

// 使い方: bun throughput.ts <保存先ドライブのパス> <ソースのフォルダ> [コピーする合計サイズ(GiB。省略時 3)]
// 目的: 1 回の読み出しで「ハッシュ計算 + コピー」を行い、書き込み後に F_NOCACHE で読み直して検証する
//       本番と同じ経路で、保存先の速度が出るか(約 60MB/s 以上)を測る
const DEFAULT_TARGET_GIB = 3;
const RANDOM_SEED = 1;
const HASH_BENCHMARK_SIZE = GIB;
const MEDIA_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.heic',
  '.mov',
  '.mp4',
  '.m2t',
  '.avi',
  '.mpg',
  '.mpeg',
]);

/** 乱数を、再現できるようにする(同じ種なら、同じ抜き出しになる) */
const createRandom = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = <T>(items: T[]): T[] => {
  const random = createRandom(RANDOM_SEED);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    const current = result[index];
    const other = result[target];
    if (current === undefined || other === undefined) continue;
    result[index] = other;
    result[target] = current;
  }
  return result;
};

type SourceFile = { path: string; size: number };

/** ソースから、合計が目標のサイズになるまで、無作為にファイルを選ぶ(読み取りだけ) */
const pickSourceFiles = (
  sourceRoot: string,
  targetBytes: number
): SourceFile[] => {
  const all: SourceFile[] = [];
  for (const entry of readdirSync(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.name.startsWith('._')) continue;
    if (!MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const path = join(entry.parentPath, entry.name);
    all.push({ path, size: statSync(path).size });
  }
  const picked: SourceFile[] = [];
  let total = 0;
  for (const file of shuffle(all)) {
    if (total >= targetBytes) break;
    picked.push(file);
    total += file.size;
  }
  return picked;
};

type CopyTimings = { fsyncSeconds: number };

/** 読み出し 1 回で、ハッシュを計算しながら、保存先に書く。ハッシュ(16 進)を返す */
const copyWithHash = (
  sourcePath: string,
  destinationPath: string,
  timings: CopyTimings
): string => {
  const partPath = `${destinationPath}.part`;
  const sourceDescriptor = openSync(sourcePath, 'r');
  const destinationDescriptor = openSync(partPath, 'w');
  // 書き込みの時点から、キャッシュに載せない。読み直しの検証が、ディスクから読むために必要(nocache.ts で確認)
  disableCache(destinationDescriptor);
  const hasher = new Bun.CryptoHasher('sha256');
  const buffer = Buffer.alloc(CHUNK_SIZE);
  while (true) {
    const bytesRead = readSync(
      sourceDescriptor,
      buffer,
      0,
      buffer.length,
      null
    );
    if (bytesRead === 0) break;
    hasher.update(buffer.subarray(0, bytesRead));
    writeSync(destinationDescriptor, buffer, 0, bytesRead);
  }
  const fsyncStartedAt = performance.now();
  fsyncSync(destinationDescriptor);
  timings.fsyncSeconds += (performance.now() - fsyncStartedAt) / 1000;
  closeSync(sourceDescriptor);
  closeSync(destinationDescriptor);
  // 一時ファイル(.part)に書いてから、正式な名前に変える(仕様書 §7)
  renameSync(partPath, destinationPath);
  removeSidecar(partPath);
  removeSidecar(destinationPath);
  return hasher.digest('hex');
};

/** 保存先のファイルを、OS のキャッシュを避けて読み直し、ハッシュを返す */
const hashWithoutCache = (path: string): string => {
  const descriptor = openSync(path, 'r');
  disableCache(descriptor);
  const hasher = new Bun.CryptoHasher('sha256');
  const buffer = Buffer.alloc(CHUNK_SIZE);
  while (true) {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    hasher.update(buffer.subarray(0, bytesRead));
  }
  closeSync(descriptor);
  return hasher.digest('hex');
};

/** ハッシュ計算だけの速さ(メモリの上)。ハッシュが、速度の足を引っ張っていないかの参考 */
const benchmarkHash = (): number => {
  const buffer = Buffer.alloc(CHUNK_SIZE);
  crypto.getRandomValues(buffer);
  const hasher = new Bun.CryptoHasher('sha256');
  const startedAt = performance.now();
  for (
    let processed = 0;
    processed < HASH_BENCHMARK_SIZE;
    processed += CHUNK_SIZE
  ) {
    hasher.update(buffer);
  }
  hasher.digest('hex');
  return megabytesPerSecond(
    HASH_BENCHMARK_SIZE,
    (performance.now() - startedAt) / 1000
  );
};

const main = async () => {
  const [mountPath, sourceRoot, targetArgument] = process.argv.slice(2);
  if (!mountPath || !sourceRoot) {
    console.error(
      '使い方: bun throughput.ts /Volumes/<ドライブ名> <ソースのフォルダ> [GiB]'
    );
    process.exit(1);
  }
  const targetBytes = Number(targetArgument ?? DEFAULT_TARGET_GIB) * GIB;

  console.log(
    `SHA-256 の計算だけ(メモリの上): ${benchmarkHash().toFixed(0)} MB/s`
  );
  const files = pickSourceFiles(sourceRoot, targetBytes);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  console.log(
    `選んだファイル: ${files.length} 個 / ${(totalBytes / GIB).toFixed(2)} GiB\n`
  );

  const directory = prepareTempDirectory(mountPath);
  const timings: CopyTimings = { fsyncSeconds: 0 };
  let copySeconds = 0;
  let verifySeconds = 0;
  let mismatches = 0;
  try {
    for (const [index, file] of files.entries()) {
      const destinationPath = join(
        directory,
        `${index}${extname(file.path).toLowerCase()}`
      );
      const copyStartedAt = performance.now();
      const expectedHash = copyWithHash(file.path, destinationPath, timings);
      copySeconds += (performance.now() - copyStartedAt) / 1000;

      const verifyStartedAt = performance.now();
      const actualHash = hashWithoutCache(destinationPath);
      verifySeconds += (performance.now() - verifyStartedAt) / 1000;
      if (actualHash !== expectedHash) mismatches++;
    }
  } finally {
    removeTempDirectory(directory);
  }

  const result = {
    files: files.length,
    gib: Number((totalBytes / GIB).toFixed(2)),
    copyAndHashMegabytesPerSecond: Number(
      megabytesPerSecond(totalBytes, copySeconds).toFixed(1)
    ),
    verifyMegabytesPerSecond: Number(
      megabytesPerSecond(totalBytes, verifySeconds).toFixed(1)
    ),
    overallMegabytesPerSecond: Number(
      megabytesPerSecond(totalBytes, copySeconds + verifySeconds).toFixed(1)
    ),
    filesPerSecond: Number(
      (files.length / (copySeconds + verifySeconds)).toFixed(1)
    ),
    copySeconds: Number(copySeconds.toFixed(1)),
    fsyncSeconds: Number(timings.fsyncSeconds.toFixed(1)),
    verifySeconds: Number(verifySeconds.toFixed(1)),
    mismatches,
  };
  await Bun.write(
    '../../data/poc-copy-verify/throughput.json',
    JSON.stringify(result, null, 2)
  );
  console.log('(実験用の一時フォルダを削除しました)\n');
  console.log(
    `コピー + ハッシュ + fsync + 名前の変更 : ${result.copyAndHashMegabytesPerSecond} MB/s (${result.copySeconds} 秒、うち fsync ${result.fsyncSeconds} 秒)`
  );
  console.log(
    `読み直しての検証(F_NOCACHE)          : ${result.verifyMegabytesPerSecond} MB/s (${result.verifySeconds} 秒)`
  );
  console.log(
    `全体(コピー + 検証)                   : ${result.overallMegabytesPerSecond} MB/s / ${result.filesPerSecond} ファイル/秒`
  );
  console.log(`ハッシュの不一致                        : ${mismatches} 件`);
};

await main();
