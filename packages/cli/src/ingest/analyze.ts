import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type DateInput,
  type DateOptions,
  type DateResolution,
  type ErrorCode,
  resolveDate,
} from '@file-seiri/core';
import type { Content, MediaDetails } from '@file-seiri/ledger';
import { resolveContent } from '../hash/index.ts';
import {
  findTakeoutJson,
  type MetadataReader,
  parseTakeoutJson,
  type TakeoutMetadata,
} from '../metadata/index.ts';
import type { ScannedFile } from '../scan/index.ts';

/** 1 ファイルの解析の結果 */
export type FileAnalysis = {
  file: ScannedFile;
  /** `source_files` の行 */
  sourceFileId: number;
  /** ファイル 1 つの日付の決定(グループの日付とは、別) */
  resolution: DateResolution;
  /** メタデータ(日付以外)。読めなかったときは、空 */
  details: MediaDetails;
  /** ハッシュを決めた内容。バイトが読めなかったときは、undefined */
  content: Content | undefined;
  /** キャッシュから得た(ハッシュを計算していない) */
  fromCache: boolean;
  /** メタデータを読めなかった(破損の疑い)。グループには入れず、`_unknown/読み取り不可/` に置く */
  unreadable: boolean;
  /** ExifTool の警告(切れた画像など)。エラーではないが、破損の手がかり(修復の段階で使う) */
  warning: string | undefined;
  /** このファイルに起きた問題。1 つだけ記録する */
  problem: { code: ErrorCode; detail: string } | undefined;
};

export type AnalyzeEnvironment = {
  db: Database;
  volumeId: number;
  metadataReader: MetadataReader;
  dateOptions: DateOptions;
  rehash: boolean;
  now: () => Date;
  /** フォルダ(ソースからの相対)ごとの、json のファイル名(Takeout)。写真・動画に対応する json を探す */
  jsonNamesByDirectory: ReadonlyMap<string, ReadonlySet<string>>;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 対応する Takeout の json を読む。なければ、読めなければ、空の結果 */
const readTakeout = (
  file: ScannedFile,
  environment: AnalyzeEnvironment
): TakeoutMetadata => {
  const names = environment.jsonNamesByDirectory.get(file.directory);
  if (!names) return {};
  const jsonName = findTakeoutJson(file.fileName, names);
  if (!jsonName) return {};
  try {
    return parseTakeoutJson(
      readFileSync(join(dirname(file.absolutePath), jsonName), 'utf8')
    );
  } catch {
    // json は、補助の情報。読めなくても、取り込みは続ける(本体のメタデータ・ファイル名で決める)
    return {};
  }
};

const withTakeoutGps = (
  details: MediaDetails,
  takeout: TakeoutMetadata
): MediaDetails => {
  if (
    details.gpsLat !== undefined ||
    takeout.gpsLat === undefined ||
    takeout.gpsLon === undefined
  ) {
    return details;
  }
  return {
    ...details,
    gpsLat: takeout.gpsLat,
    gpsLon: takeout.gpsLon,
    ...(takeout.gpsAlt === undefined ? {} : { gpsAlt: takeout.gpsAlt }),
  };
};

/**
 * 1 ファイルを解析する: メタデータ → 日付 → ハッシュ(キャッシュ)。
 * - `xmp` は、メタデータを読まない(ファイル名と更新日だけで、日付を決める。グループの代表には、なりにくい)。
 * - メタデータを読めなければ `unreadable`(`CORRUPTED`。修復は、まだ行わない)。
 * - ハッシュを計算できなければ(読めない・読んでいる間に変わった)、`READ_FAILED`。
 * 例外にはしない(1 つのファイルの失敗で、実行全体を止めないため)。
 */
export const analyzeFile = async (
  file: ScannedFile,
  sourceFileId: number,
  environment: AnalyzeEnvironment
): Promise<FileAnalysis> => {
  const mtime = new Date(file.mtimeMs);
  let dateInput: DateInput = { fileName: file.fileName, mtime };
  let details: MediaDetails = {};
  let unreadable = false;
  let warning: string | undefined;
  let problem: FileAnalysis['problem'];

  if (file.kind !== 'xmp') {
    const read = await environment.metadataReader.read(
      file.absolutePath,
      file.kind === 'video'
    );
    const takeout = readTakeout(file, environment);
    if (read.ok) {
      dateInput = {
        fileName: file.fileName,
        mtime,
        ...read.metadata.dates,
        ...(takeout.photoTakenEpochSeconds === undefined
          ? {}
          : { takeoutPhotoTakenEpochSeconds: takeout.photoTakenEpochSeconds }),
      };
      details = withTakeoutGps(read.metadata.details, takeout);
      warning = read.metadata.warning;
    } else {
      unreadable = true;
      problem = {
        code: 'CORRUPTED',
        detail: `メタデータを読めません: ${read.error}`,
      };
    }
  }

  let content: Content | undefined;
  let fromCache = false;
  try {
    const resolved = await resolveContent(environment.db, {
      volumeId: environment.volumeId,
      relPath: file.relPath,
      absolutePath: file.absolutePath,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      rehash: environment.rehash,
      now: environment.now,
    });
    content = resolved.content;
    fromCache = resolved.fromCache;
  } catch (error) {
    // バイトが読めない(または、読んでいる間に変わった)ものは、コピーできない。メタデータの問題より、重い
    problem = { code: 'READ_FAILED', detail: messageOf(error) };
  }

  return {
    file,
    sourceFileId,
    resolution: resolveDate(dateInput, environment.dateOptions),
    details,
    content,
    fromCache,
    unreadable,
    warning,
    problem,
  };
};
