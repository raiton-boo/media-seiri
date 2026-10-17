import type { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ErrorCode } from '@file-seiri/core';
import {
  findProcessedSourceFile,
  finishRun,
  incrementRevision,
  insertSourceFile,
  recordError,
  recordEvent,
  setSourceFileState,
  startRun,
  toSourceFileKind,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import {
  createMetadataReader,
  type MetadataReader,
} from '../metadata/index.ts';
import {
  collectScan,
  type ScannedFile,
  type ScanSummary,
} from '../scan/index.ts';
import { recordVolume, type VolumeInfo } from '../volume/index.ts';
import {
  type AnalyzeEnvironment,
  analyzeFile,
  type FileAnalysis,
} from './analyze.ts';
import { mapConcurrent, readConcurrency } from './concurrency.ts';
import { type OpenedLibrary, openLibraryForIngest } from './library.ts';
import { buildPlan, type IngestPlan } from './plan.ts';
import {
  assertDifferentVolumes,
  capacityProblem,
  checkDestinationVolume,
  checkFat32Limit,
  estimateCapacity,
  type Problem,
} from './preflight.ts';
import { recordPlan } from './record.ts';
import {
  describeVolume,
  emptySummary,
  formatSummary,
  type IngestSummary,
} from './summary.ts';

const PROGRESS_INTERVAL = 1000;
const COMMIT_BATCH_SIZE = 500;

export type IngestOptions = {
  sources: string[];
  destination: string;
  dryRun: boolean;
  rehash: boolean;
  restoreSnapshot: boolean;
};

const countKind = (
  items: readonly ScannedFile[],
  kind: ScannedFile['kind']
): number => items.filter((file) => file.kind === kind).length;

/** スキャンで見つけたファイルを、`source_files` に記録する。処理済み・対象外は、記録しない。分析する行の一覧を返す */
const recordScan = (
  db: Database,
  input: { runId: number; volumeId: number; scan: ScanSummary },
  now: () => Date,
  summary: IngestSummary
): { rows: { file: ScannedFile; sourceFileId: number }[] } => {
  const rows: { file: ScannedFile; sourceFileId: number }[] = [];
  const { runId, volumeId, scan } = input;
  const at = now();

  const targets = scan.files.filter(
    (file) =>
      file.kind === 'photo' ||
      file.kind === 'raw' ||
      file.kind === 'video' ||
      file.kind === 'xmp'
  );
  summary.unsupported = countKind(scan.files, 'unsupported');
  summary.takeoutJson = countKind(scan.files, 'json');
  summary.archives = countKind(scan.files, 'archive');
  summary.excluded = scan.skipped.length;

  for (let start = 0; start < targets.length; start += COMMIT_BATCH_SIZE) {
    db.transaction(() => {
      for (const file of targets.slice(start, start + COMMIT_BATCH_SIZE)) {
        // 再実行で、処理済み(同じボリューム・パス・サイズ・更新日)のものは、スキップする(仕様書 §8-3)
        if (
          findProcessedSourceFile(db, {
            volumeId,
            relPath: file.relPath,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
          })
        ) {
          summary.alreadyProcessed += 1;
          continue;
        }
        const kind = toSourceFileKind(
          file.kind === 'xmp' ? 'xmp' : (file.kind as 'photo' | 'raw' | 'video')
        );
        if (!kind) continue;
        const sourceFileId = insertSourceFile(db, {
          runId,
          volumeId,
          relPath: file.relPath,
          sizeBytes: file.sizeBytes,
          mtimeMs: file.mtimeMs,
          kind,
          ext: file.ext,
        });
        rows.push({ file, sourceFileId });
        summary.detected += 1;
        if (file.kind === 'photo') summary.photos += 1;
        else if (file.kind === 'raw') summary.raws += 1;
        else if (file.kind === 'video') summary.videos += 1;
        else summary.sidecars += 1;
      }
    })();
  }

  // 空ファイル・読めなかった場所は、エラー一覧に記録する(仕様書 §1-2)
  db.transaction(() => {
    for (const file of scan.emptyFiles) {
      const kind = toSourceFileKind(
        file.kind === 'xmp' ? 'xmp' : (file.kind as 'photo' | 'raw' | 'video')
      );
      if (!kind) continue;
      const sourceFileId = insertSourceFile(db, {
        runId,
        volumeId,
        relPath: file.relPath,
        sizeBytes: 0,
        mtimeMs: file.mtimeMs,
        kind,
        ext: file.ext,
      });
      setSourceFileState(db, sourceFileId, 'error');
      recordError(db, {
        runId,
        sourceFileId,
        code: 'EMPTY_FILE',
        detail: '空のファイル(0 バイト)です',
        occurredAt: at,
      });
      summary.emptyFiles += 1;
    }
    for (const entry of scan.unreadable) {
      recordError(db, {
        runId,
        code: 'READ_FAILED',
        detail: `${entry.relPath}: ${entry.detail}`,
        occurredAt: at,
      });
      summary.errorsByCode.READ_FAILED =
        (summary.errorsByCode.READ_FAILED ?? 0) + 1;
      summary.errorFiles += 1;
    }
  })();
  return { rows };
};

/** 解析と予定から、サマリーの件数を数える */
const tally = (
  analyses: readonly FileAnalysis[],
  plan: IngestPlan,
  summary: IngestSummary
): void => {
  const bump = (code: ErrorCode): void => {
    summary.errorsByCode[code] = (summary.errorsByCode[code] ?? 0) + 1;
  };
  analyses.forEach((analysis, index) => {
    const filePlan = plan.files[index];
    if (analysis.metadataError) summary.metadataUnreadable += 1;
    if (analysis.content) {
      if (analysis.fromCache) summary.hashFromCache += 1;
      else summary.hashComputed += 1;
    }
    if (analysis.problem) {
      bump(analysis.problem.code);
      summary.errorFiles += 1;
    }
    switch (filePlan?.action) {
      case 'copy': {
        summary.copyFiles += 1;
        summary.copyBytes += analysis.file.sizeBytes;
        const date = plan.groupDates[filePlan.groupIndex];
        if (date?.source === 'json') summary.fallbackJson += 1;
        else if (date?.source === 'filename') summary.fallbackFilename += 1;
        if (date?.precision === 'none') summary.unknownNone += 1;
        else if (date?.precision === 'invalid') summary.unknownInvalid += 1;
        break;
      }
      case 'duplicate':
        if (filePlan.adoptedLibraryFileId === undefined)
          summary.duplicatesInRun += 1;
        else summary.duplicatesInLibrary += 1;
        break;
      case 'orphan-sidecar':
        summary.orphanSidecars += 1;
        break;
      case 'error':
        if (!analysis.problem) {
          bump('COPY_FAILED');
          summary.errorFiles += 1;
        }
        break;
      default:
        break;
    }
  });
};

type SourceEnvironment = {
  context: CommandContext;
  library: OpenedLibrary;
  destinationVolume: VolumeInfo;
  metadataReader: MetadataReader;
  options: IngestOptions;
};

/** 1 つのソースを、取り込む(dry-run: 保存先には、書かない)。終了コードを返す */
const ingestSource = async (
  environment: SourceEnvironment,
  source: string
): Promise<ExitCode> => {
  const { context, library, destinationVolume, metadataReader, options } =
    environment;
  const { db } = library.ledger;
  const sourceRoot = resolve(source);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new CliError(`ソースのフォルダがありません: ${sourceRoot}`);
  }
  const sourceVolume = context.resolveVolume(sourceRoot);
  assertDifferentVolumes(sourceVolume, destinationVolume);

  const volume = recordVolume(db, sourceVolume, context.now());
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: options.dryRun,
    startedAt: context.now(),
  });
  const log = (code: string, message: string): void => {
    recordEvent(db, {
      runId,
      level: 'INFO',
      code,
      message,
      occurredAt: context.now(),
    });
  };
  log(
    'RUN_START',
    `${options.dryRun ? 'dry-run' : '取り込み'}を始めます: ${sourceRoot}`
  );
  const summary = emptySummary();

  try {
    context.stdout(`スキャン: ${sourceRoot}`);
    const scan = collectScan({
      sourceRoot,
      volume: sourceVolume,
      excludePaths: [library.root, context.dataDir],
    });
    const { rows } = recordScan(
      db,
      { runId, volumeId: volume.volumeId, scan },
      context.now,
      summary
    );
    context.stdout(
      `  ${scan.files.length + scan.emptyFiles.length} ファイルを見つけました(解析する対象: ${rows.length})`
    );

    const jsonNamesByDirectory = new Map<string, Set<string>>();
    for (const file of scan.files) {
      if (file.kind !== 'json') continue;
      const names =
        jsonNamesByDirectory.get(file.directory) ?? new Set<string>();
      names.add(file.fileName);
      jsonNamesByDirectory.set(file.directory, names);
    }
    const analyzeEnvironment: AnalyzeEnvironment = {
      db,
      volumeId: volume.volumeId,
      metadataReader,
      dateOptions: { now: context.now(), timeZone: context.timeZone },
      rehash: options.rehash,
      now: context.now,
      jsonNamesByDirectory,
    };
    let analyzed = 0;
    const analyses = await mapConcurrent(
      rows,
      readConcurrency(sourceVolume.mediaKind),
      async ({ file, sourceFileId }) => {
        const analysis = await analyzeFile(
          file,
          sourceFileId,
          analyzeEnvironment
        );
        analyzed += 1;
        if (analyzed % PROGRESS_INTERVAL === 0)
          context.stdout(`  解析: ${analyzed} / ${rows.length}`);
        return analysis;
      }
    );

    const plan = buildPlan(analyses, { db, libraryRoot: library.root });
    tally(analyses, plan, summary);
    summary.sequencedGroups = plan.sequencedGroups;

    const problems: Problem[] = checkFat32Limit(
      destinationVolume,
      analyses.flatMap((analysis, index) =>
        plan.files[index]?.action === 'copy' ? [analysis.file.sizeBytes] : []
      )
    );
    summary.capacity = estimateCapacity(
      summary.copyBytes,
      destinationVolume.freeBytes
    );
    const shortage = capacityProblem(summary.capacity);
    if (shortage) problems.push(shortage);
    summary.problems = problems;

    recordPlan({ db, runId, now: context.now }, analyses, plan);
    db.transaction(() => {
      const revision = incrementRevision(db);
      finishRun(db, runId, {
        status: 'completed',
        finishedAt: context.now(),
        revisionAfter: revision,
      });
      log('RUN_END', `${options.dryRun ? 'dry-run' : '取り込み'}を終えました`);
    })();

    for (const line of formatSummary(summary, {
      source: describeVolume(sourceVolume),
      destination: describeVolume(destinationVolume),
      isDryRun: options.dryRun,
    })) {
      context.stdout(line);
    }
    if (summary.problems.length > 0) return EXIT_CODES.failed;
    return summary.errorFiles + summary.emptyFiles > 0
      ? EXIT_CODES.completedWithErrors
      : EXIT_CODES.ok;
  } catch (error) {
    finishRun(db, runId, { status: 'failed', finishedAt: context.now() });
    throw error;
  }
};

/**
 * `ingest` を実行する。ソースは、1 つずつ順番に処理する(同じハブの USB の帯域を奪い合わないため。仕様書 §9-1)。
 * 終了コードは、ソースごとの結果のうち、いちばん重いもの。
 */
export const runIngest = async (
  context: CommandContext,
  options: IngestOptions
): Promise<ExitCode> => {
  if (!options.dryRun) {
    throw new CliError(
      '本実行(コピー)は、まだ実装していません。--dry-run を付けて、結果を確認してください。'
    );
  }
  const library = await openLibraryForIngest(context, options.destination, {
    restoreSnapshot: options.restoreSnapshot,
  });
  const metadataReader = createMetadataReader();
  try {
    const destinationVolume = context.resolveVolume(library.root);
    const problems = checkDestinationVolume(destinationVolume);
    if (problems.length > 0) {
      for (const problem of problems)
        context.stderr(`エラー(${problem.code}): ${problem.message}`);
      return EXIT_CODES.failed;
    }
    let worst: ExitCode = EXIT_CODES.ok;
    for (const source of options.sources) {
      const code = await ingestSource(
        { context, library, destinationVolume, metadataReader, options },
        source
      );
      if (code > worst) worst = code;
    }
    return worst;
  } finally {
    await metadataReader.close();
    library.ledger.close();
  }
};
