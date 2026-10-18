import type { Database } from 'bun:sqlite';
import { readFileSync, statSync } from 'node:fs';
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
  type AttemptLog,
  describeAttempts,
  type RepairTools,
  repairFile,
} from '../repair/index.ts';
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
  /**
   * 破損の検査・修復の結果(疑わしいファイルだけ。破損でなければ、なし)。
   * - `repaired`: 修復できた。`file` は、修復後のファイル(`repaired/`)に差し替え、`content`・`details`・`resolution` も、修復後のもの。元の場所は、`file.relPath` のまま。
   * - `unreadable`: 直せなかった(`REPAIR_FAILED`)、または、修復を試みなかった(`CORRUPTED`)。元のバイトのまま、`_unknown/読み取り不可/` へ。
   */
  corruption: CorruptionOutcome | undefined;
};

export type CorruptionOutcome =
  | { verdict: 'repaired'; attempts: AttemptLog[]; detail: string }
  | {
      verdict: 'unreadable';
      code: 'REPAIR_FAILED' | 'CORRUPTED';
      attempts: AttemptLog[];
      detail: string;
    };

export type AnalyzeEnvironment = {
  db: Database;
  volumeId: number;
  metadataReader: MetadataReader;
  dateOptions: DateOptions;
  rehash: boolean;
  now: () => Date;
  /** 破損の検査と修復(なければ、行わない)。検査は、メタデータが読めない・ExifTool の警告があるファイルだけに行う */
  repair?: {
    tools: RepairTools;
    /** 修復で作る別ファイルを置くフォルダ(`data/libraries/<ID>/repaired/`) */
    outputDir: string;
    /** dry-run は、修復を試みない(破損と分かっても、`CORRUPTED` の記録だけ) */
    dryRun: boolean;
  };
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
  let currentFile = file;
  let dateInput: DateInput = { fileName: file.fileName, mtime };
  let details: MediaDetails = {};
  let metadataError: string | undefined;
  let warning: string | undefined;
  let problem: FileAnalysis['problem'];
  let content: Content | undefined;
  let fromCache = false;
  let corruption: CorruptionOutcome | undefined;

  // ZIP の中のファイルは、一時領域に取り出して読む(終わったら、すぐ消す)。取り出せなければ、読めないものとして扱う
  let materialized: Materialized | undefined;
  try {
    materialized = await materializeFile(file);
  } catch (error) {
    problem = problemOf(error);
  }

  if (materialized) {
    try {
      const takeout =
        file.kind === 'xmp' ? {} : await readTakeout(file, environment);
      /** メタデータ(日付以外も)と、日付の入力を読む。読めなくても、Takeout の json があれば、日付に使う */
      const readMetadata = async (path: string) => {
        const read = await environment.metadataReader.read(
          path,
          file.kind === 'video'
        );
        const takeoutDate =
          takeout.photoTakenEpochSeconds === undefined
            ? {}
            : { takeoutPhotoTakenEpochSeconds: takeout.photoTakenEpochSeconds };
        if (read.ok) {
          return {
            dateInput: {
              fileName: file.fileName,
              mtime,
              ...read.metadata.dates,
              ...takeoutDate,
            } as DateInput,
            details: withTakeoutGps(read.metadata.details, takeout),
            metadataError: undefined as string | undefined,
            warning: read.metadata.warning,
          };
        }
        return {
          dateInput: {
            fileName: file.fileName,
            mtime,
            ...takeoutDate,
          } as DateInput,
          details: withTakeoutGps({}, takeout),
          metadataError: read.error as string | undefined,
          warning: undefined as string | undefined,
        };
      };

      if (file.kind !== 'xmp') {
        ({ dateInput, details, metadataError, warning } = await readMetadata(
          materialized.path
        ));
      }

      // 破損の検査: メタデータが読めない・ExifTool の警告があるファイルだけ(全部に、デコードをかけると、遅いため)。
      // 読めないだけでは、破損としない。デコード・ストリーム・プレビューの検査で、確かめる(仕様書 §10-2)
      let hashPath = materialized.path;
      const repairKind =
        file.kind === 'photo' || file.kind === 'raw' || file.kind === 'video'
          ? file.kind
          : undefined;
      if (environment.repair && repairKind && (metadataError || warning)) {
        const { tools, outputDir, dryRun } = environment.repair;
        const check = await tools.check(
          materialized.path,
          repairKind,
          file.ext
        );
        if (check.status === 'corrupt') {
          if (dryRun) {
            corruption = {
              verdict: 'unreadable',
              code: 'CORRUPTED',
              attempts: [],
              detail: `破損しています(${check.detail})。dry-run のため、修復は試みていません`,
            };
          } else {
            const outcome = await repairFile({
              tools,
              kind: repairKind,
              ext: file.ext,
              sourcePath: materialized.path,
              outputDir,
              baseName: `${sourceFileId}-${file.fileName}`,
            });
            if (outcome.verdict === 'repaired') {
              const stats = statSync(outcome.outputPath);
              ({ dateInput, details, metadataError, warning } =
                await readMetadata(outcome.outputPath));
              // 修復後のファイルに差し替える(元の場所の記録は、元のソースのパスのまま)
              currentFile = {
                ...file,
                absolutePath: outcome.outputPath,
                materialize: undefined,
                sizeBytes: stats.size,
                mtimeMs: stats.mtimeMs,
              };
              hashPath = outcome.outputPath;
              corruption = {
                verdict: 'repaired',
                attempts: outcome.attempts,
                detail: `修復しました(${describeAttempts(outcome.attempts)})`,
              };
            } else {
              const skipped = outcome.skipped;
              corruption = {
                verdict: 'unreadable',
                code:
                  outcome.verdict === 'not-attempted'
                    ? 'CORRUPTED'
                    : 'REPAIR_FAILED',
                attempts: outcome.attempts,
                detail:
                  outcome.verdict === 'not-attempted'
                    ? `破損しています(${check.detail})。修復の道具が使えないため、試みていません(${describeAttempts([], skipped)})`
                    : `破損しています(${check.detail})。修復できませんでした: ${describeAttempts(outcome.attempts, skipped)}`,
              };
            }
          }
        }
      }

      try {
        const stats = statSync(hashPath);
        const resolved = await resolveContent(environment.db, {
          volumeId: environment.volumeId,
          relPath: currentFile.relPath,
          absolutePath: hashPath,
          sizeBytes: currentFile === file ? file.sizeBytes : stats.size,
          mtimeMs: currentFile === file ? file.mtimeMs : stats.mtimeMs,
          // 修復後のファイルは、毎回、新しく作るので、キャッシュを使わない
          rehash: environment.rehash || currentFile !== file,
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
    file: currentFile,
    sourceFileId,
    resolution: resolveDate(dateInput, environment.dateOptions),
    details,
    content,
    fromCache,
    metadataError,
    warning,
    problem,
    corruption,
  };
};
