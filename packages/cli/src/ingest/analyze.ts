import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import {
  type DateInput,
  type DateOptions,
  type DateResolution,
  type ErrorCode,
  resolveDate,
} from '@file-seiri/core';
import type { Content, MediaDetails } from '@file-seiri/ledger';
import { ZipExtractError } from '../archive/index.ts';
import { resolveContent } from '../hash/index.ts';
import {
  findTakeoutJson,
  type MetadataReader,
  parseTakeoutJson,
  type TakeoutMetadata,
} from '../metadata/index.ts';
import {
  type Materialized,
  materializeFile,
  type ScannedFile,
  withMaterialized,
} from '../scan/index.ts';

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
  /**
   * メタデータを読めなかった理由。読めなかっただけで、破損とは限らない(写真として開けるかもしれない)ため、
   * 普通のファイルと同じ流れにする。日付は、ファイル名・Takeout の json で決める。
   */
  metadataError: string | undefined;
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
  /** フォルダ(ソースからの相対。ZIP の中も)ごとの、json のファイル(Takeout)。写真・動画に対応する json を探す */
  jsonFilesByDirectory: ReadonlyMap<string, ReadonlyMap<string, ScannedFile>>;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** ZIP から取り出せなかった原因を、エラーの種類にする(暗号化 → `ZIP_ENCRYPTED`、ほかは `READ_FAILED`) */
const problemOf = (error: unknown): { code: ErrorCode; detail: string } => ({
  code:
    error instanceof ZipExtractError && error.kind === 'encrypted'
      ? 'ZIP_ENCRYPTED'
      : 'READ_FAILED',
  detail: messageOf(error),
});

/** 対応する Takeout の json を読む。なければ、読めなければ、空の結果 */
const readTakeout = async (
  file: ScannedFile,
  environment: AnalyzeEnvironment
): Promise<TakeoutMetadata> => {
  const jsonFiles = environment.jsonFilesByDirectory.get(file.directory);
  if (!jsonFiles) return {};
  const jsonName = findTakeoutJson(file.fileName, new Set(jsonFiles.keys()));
  const jsonFile = jsonName === undefined ? undefined : jsonFiles.get(jsonName);
  if (!jsonFile) return {};
  try {
    // ZIP の中の json は、一時領域に出して読み、すぐ消す
    return await withMaterialized(jsonFile, async (path) =>
      parseTakeoutJson(readFileSync(path, 'utf8'))
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
 * - メタデータを読めなくても、破損とはしない(`metadataError` に理由を残し、日付は、ファイル名・json で決める)。
 *   破損は、デコードなどが失敗したときで、別の段階(修復)で扱う(仕様書 §10)。
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
  let metadataError: string | undefined;
  let warning: string | undefined;
  let problem: FileAnalysis['problem'];
  let content: Content | undefined;
  let fromCache = false;

  // ZIP の中のファイルは、一時領域に取り出して読む(終わったら、すぐ消す)。取り出せなければ、読めないものとして扱う
  let materialized: Materialized | undefined;
  try {
    materialized = await materializeFile(file);
  } catch (error) {
    problem = problemOf(error);
  }

  if (materialized) {
    try {
      if (file.kind !== 'xmp') {
        const read = await environment.metadataReader.read(
          materialized.path,
          file.kind === 'video'
        );
        const takeout = await readTakeout(file, environment);
        if (read.ok) {
          dateInput = {
            fileName: file.fileName,
            mtime,
            ...read.metadata.dates,
            ...(takeout.photoTakenEpochSeconds === undefined
              ? {}
              : {
                  takeoutPhotoTakenEpochSeconds: takeout.photoTakenEpochSeconds,
                }),
          };
          details = withTakeoutGps(read.metadata.details, takeout);
          warning = read.metadata.warning;
        } else {
          metadataError = read.error;
          // 読めなかった場合も、Takeout の json があれば、日付に使う
          if (takeout.photoTakenEpochSeconds !== undefined) {
            dateInput = {
              ...dateInput,
              takeoutPhotoTakenEpochSeconds: takeout.photoTakenEpochSeconds,
            };
          }
          details = withTakeoutGps({}, takeout);
        }
      }

      try {
        const resolved = await resolveContent(environment.db, {
          volumeId: environment.volumeId,
          relPath: file.relPath,
          absolutePath: materialized.path,
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
    } finally {
      await materialized.cleanup();
    }
  }

  return {
    file,
    sourceFileId,
    resolution: resolveDate(dateInput, environment.dateOptions),
    details,
    content,
    fromCache,
    metadataError,
    warning,
    problem,
  };
};
