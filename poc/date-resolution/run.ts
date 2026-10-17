import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  type ExifDate,
  ExifDateTime,
  exiftool,
  type Tags,
} from 'exiftool-vendored';
import yauzl from 'yauzl';
import {
  type DateParts,
  isValidParts,
  type MetadataDate,
  resolveDate,
} from './resolve.ts';

// 使い方: bun run.ts <ラベル> <ルートのパス> <抜き出す件数(省略すると、すべて)>
// 結果の詳細は、写真のファイル名を含みうるため、リポジトリに入れない(data/ は .gitignore 済み)
const OUTPUT_DIRECTORY = '../../data/poc-date-resolution';
const TEMP_DIRECTORY = `${OUTPUT_DIRECTORY}/tmp`;
const RANDOM_SEED = 1;
const BATCH_SIZE = 8;
const TOP_SHAPE_COUNT = 25;

// 仕様書 §1-1 の対象の拡張子
const PHOTO_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.heic',
  '.heif',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.dng',
  '.orf',
  '.rw2',
  '.raw',
]);
const VIDEO_EXTENSIONS = new Set([
  '.mov',
  '.mp4',
  '.m4v',
  '.m2t',
  '.m2ts',
  '.mts',
  '.avi',
  '.mpg',
  '.mpeg',
  '.wmv',
  '.3gp',
  '.webm',
]);

type MediaClass = 'photo' | 'video';
type Origin = 'file' | 'zip-entry';

type Candidate = {
  origin: Origin;
  mediaClass: MediaClass;
  /** 実ファイルのパス。ZIP の中のものは、ZIP のパス */
  path: string;
  /** ZIP の中のものだけ */
  entryName?: string;
  fileName: string;
  extension: string;
};

type Tally = Record<string, number>;

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

const classify = (extension: string): MediaClass | undefined => {
  if (PHOTO_EXTENSIONS.has(extension)) return 'photo';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return undefined;
};

/** ファイル名の「形」だけを残す(数字を # に)。写真の名前そのものは、残さない */
const shapeOf = (fileName: string): string =>
  fileName.replace(/\d+/g, '#').toLowerCase();

const increment = (tally: Tally, key: string) => {
  tally[key] = (tally[key] ?? 0) + 1;
};

// ---------- メタデータ ----------

const toParts = (value: ExifDateTime | ExifDate): DateParts =>
  value instanceof ExifDateTime
    ? {
        year: value.year,
        month: value.month,
        day: value.day,
        hour: value.hour,
        minute: value.minute,
        second: value.second,
      }
    : { year: value.year, month: value.month, day: value.day };

/**
 * 日付のタグを、優先順位(撮影日時 → 作成日時)で読む。
 * ExifTool が日付として解釈できなかった値(0000:00:00 など)は、文字列のまま返るため、invalid とする。
 */
const toMetadataDate = (tags: Tags): MetadataDate => {
  const values = [tags.DateTimeOriginal, tags.CreateDate, tags.MediaCreateDate];
  let hasInvalid = false;
  for (const value of values) {
    if (value === undefined) continue;
    // 日付として解釈できなかった値は、文字列か数値のまま返る
    if (typeof value === 'string' || typeof value === 'number') {
      hasInvalid = true;
      continue;
    }
    const parts = toParts(value);
    if (!isValidParts(parts) || parts.year < 1) {
      hasInvalid = true;
      continue;
    }
    return {
      kind: 'found',
      precision: value instanceof ExifDateTime ? 'full' : 'date',
      parts,
    };
  }
  return hasInvalid ? { kind: 'invalid' } : { kind: 'none' };
};

// ---------- ZIP ----------

const openZip = (path: string): Promise<yauzl.ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false },
      (error, zipFile) => {
        if (error || !zipFile) reject(error ?? new Error('zip を開けない'));
        else resolve(zipFile);
      }
    );
  });

const listZipEntries = async (path: string): Promise<yauzl.Entry[]> => {
  const zipFile = await openZip(path);
  const entries: yauzl.Entry[] = [];
  await new Promise<void>((resolve, reject) => {
    zipFile.on('entry', (entry: yauzl.Entry) => {
      if (!entry.fileName.endsWith('/')) entries.push(entry);
      zipFile.readEntry();
    });
    zipFile.on('end', resolve);
    zipFile.on('error', reject);
    zipFile.readEntry();
  });
  zipFile.close();
  return entries;
};

/** ZIP の中の 1 エントリを、一時ファイルに取り出す(ExifTool はファイルしか読めないため) */
const extractEntry = async (
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  outputPath: string
) => {
  const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error || !readStream)
        reject(error ?? new Error('エントリを読めない'));
      else resolve(readStream);
    });
  });
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  await Bun.write(outputPath, Buffer.concat(chunks));
};

// ---------- 収集 ----------

const collectFiles = (
  root: string
): { candidates: Candidate[]; zipPaths: string[]; skipped: Tally } => {
  const candidates: Candidate[] = [];
  const zipPaths: string[] = [];
  const skipped: Tally = {};
  for (const entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const extension = extname(entry.name).toLowerCase();
    if (extension === '.zip') {
      zipPaths.push(path);
      continue;
    }
    const mediaClass = classify(extension);
    if (!mediaClass) {
      increment(skipped, extension || '(なし)');
      continue;
    }
    candidates.push({
      origin: 'file',
      mediaClass,
      path,
      fileName: entry.name,
      extension,
    });
  }
  return { candidates, zipPaths, skipped };
};

// ---------- 集計 ----------

type GroupStats = {
  total: number;
  bySource: Tally;
  byPrecision: Tally;
  bySourceAndPrecision: Tally;
  filenamePatterns: Tally;
  unresolvedShapes: Tally;
  readErrors: number;
  /** 本体のメタデータの年と、ファイルの更新日(mtime)の年が、違うもの */
  mtimeYearDiffers: number;
  metadataSourced: number;
};

const createStats = (): GroupStats => ({
  total: 0,
  bySource: {},
  byPrecision: {},
  bySourceAndPrecision: {},
  filenamePatterns: {},
  unresolvedShapes: {},
  readErrors: 0,
  mtimeYearDiffers: 0,
  metadataSourced: 0,
});

const topEntries = (tally: Tally, limit: number): [string, number][] =>
  Object.entries(tally)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);

const main = async () => {
  const [label, root, sampleArgument] = process.argv.slice(2);
  if (!label || !root) {
    console.error('使い方: bun run.ts <ラベル> <ルートのパス> [件数]');
    process.exit(1);
  }
  mkdirSync(TEMP_DIRECTORY, { recursive: true });

  const startedAt = performance.now();
  const { candidates, zipPaths, skipped } = collectFiles(root);
  const sampleSize = sampleArgument
    ? Number(sampleArgument)
    : candidates.length;
  const sampled = shuffle(candidates).slice(0, sampleSize);
  console.log(
    `[${label}] 対象 ${candidates.length} ファイル中 ${sampled.length} 件を抜き出す / ZIP ${zipPaths.length} 個 / 対象外 ${Object.values(skipped).reduce((sum, count) => sum + count, 0)} 件`
  );

  const stats: Record<string, GroupStats> = {};
  const getGroupStats = (group: string): GroupStats => {
    const existing = stats[group];
    if (existing) return existing;
    const created = createStats();
    stats[group] = created;
    return created;
  };
  const record = (
    candidate: Candidate,
    metadata: MetadataDate,
    mtime: Date | undefined,
    readFailed: boolean
  ) => {
    const group = `${candidate.origin}/${candidate.mediaClass}`;
    const groupStats = getGroupStats(group);
    groupStats.total++;
    if (readFailed) groupStats.readErrors++;
    const nameForParsing = candidate.entryName
      ? basename(candidate.entryName)
      : candidate.fileName;
    const resolution = resolveDate(metadata, nameForParsing);
    increment(groupStats.bySource, resolution.source);
    increment(groupStats.byPrecision, resolution.precision);
    increment(
      groupStats.bySourceAndPrecision,
      `${resolution.source}/${resolution.precision}`
    );
    if (resolution.source === 'filename' && resolution.pattern) {
      increment(groupStats.filenamePatterns, resolution.pattern);
    }
    if (resolution.source === 'none') {
      increment(groupStats.unresolvedShapes, shapeOf(nameForParsing));
    }
    if (resolution.source === 'metadata' && mtime && resolution.parts) {
      groupStats.metadataSourced++;
      if (mtime.getFullYear() !== resolution.parts.year)
        groupStats.mtimeYearDiffers++;
    }
  };

  // 通常のファイル: BATCH_SIZE 件ずつ、並行して読む
  for (let offset = 0; offset < sampled.length; offset += BATCH_SIZE) {
    const batch = sampled.slice(offset, offset + BATCH_SIZE);
    await Promise.all(
      batch.map(async (candidate) => {
        let metadata: MetadataDate = { kind: 'none' };
        let readFailed = false;
        try {
          metadata = toMetadataDate(await exiftool.read(candidate.path));
        } catch {
          readFailed = true;
        }
        record(candidate, metadata, statSync(candidate.path).mtime, readFailed);
      })
    );
  }

  // ZIP: 数が少ないので、中の対象をすべて読む
  let zipEntryCount = 0;
  for (const zipPath of zipPaths) {
    const entries = await listZipEntries(zipPath);
    const zipFile = await openZip(zipPath);
    let temporaryIndex = 0;
    for (const entry of entries) {
      const extension = extname(entry.fileName).toLowerCase();
      const mediaClass = classify(extension);
      if (!mediaClass) continue;
      zipEntryCount++;
      const candidate: Candidate = {
        origin: 'zip-entry',
        mediaClass,
        path: zipPath,
        entryName: entry.fileName,
        fileName: basename(entry.fileName),
        extension,
      };
      const temporaryPath = join(
        TEMP_DIRECTORY,
        `entry-${temporaryIndex++}${extension}`
      );
      let metadata: MetadataDate = { kind: 'none' };
      let readFailed = false;
      try {
        await extractEntry(zipFile, entry, temporaryPath);
        metadata = toMetadataDate(await exiftool.read(temporaryPath));
      } catch {
        readFailed = true;
      } finally {
        rmSync(temporaryPath, { force: true });
      }
      record(candidate, metadata, entry.getLastModDate(), readFailed);
    }
    zipFile.close();
  }
  await exiftool.end();

  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const summary = {
    label,
    sampled: sampled.length,
    zipFiles: zipPaths.length,
    zipEntriesRead: zipEntryCount,
    skippedByExtension: topEntries(skipped, 15),
    elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
    groups: Object.fromEntries(
      Object.entries(stats).map(([group, value]) => [
        group,
        {
          ...value,
          unresolvedShapes: topEntries(value.unresolvedShapes, TOP_SHAPE_COUNT),
        },
      ])
    ),
  };
  await Bun.write(
    `${OUTPUT_DIRECTORY}/${label}.json`,
    JSON.stringify(summary, null, 2)
  );
  rmSync(TEMP_DIRECTORY, { recursive: true, force: true });

  console.log(`\n=== ${label}: ${elapsedSeconds.toFixed(1)} 秒 ===`);
  for (const [group, value] of Object.entries(stats)) {
    console.log(
      `\n[${group}] ${value.total} 件 (読み取りエラー ${value.readErrors})`
    );
    console.log('  取得元:', JSON.stringify(value.bySource));
    console.log('  精度  :', JSON.stringify(value.byPrecision));
    console.log('  取得元/精度:', JSON.stringify(value.bySourceAndPrecision));
    if (Object.keys(value.filenamePatterns).length > 0) {
      console.log(
        '  ファイル名のパターン:',
        JSON.stringify(value.filenamePatterns)
      );
    }
    if (value.metadataSourced > 0) {
      console.log(
        `  メタデータの年と mtime の年が違う: ${value.mtimeYearDiffers} / ${value.metadataSourced}`
      );
    }
    const shapes = topEntries(value.unresolvedShapes, 10);
    if (shapes.length > 0) {
      console.log('  日付が取れなかった名前の形(上位):');
      for (const [shape, count] of shapes)
        console.log(`    ${String(count).padStart(5)}  ${shape}`);
    }
  }
};

await main();
