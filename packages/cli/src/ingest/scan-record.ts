import type { Database } from 'bun:sqlite';
import type { ErrorCode } from '@file-seiri/core';
import {
  findProcessedSourceFile,
  findSourceFileInRun,
  insertSourceFile,
  recordError,
  recordEvent,
  setSourceFileState,
  toSourceFileKind,
} from '@file-seiri/ledger';
import type { ScannedFile, ScanSummary } from '../scan/index.ts';
import type { FileAnalysis } from './analyze.ts';
import type { IngestPlan } from './plan.ts';
import type { IngestSummary } from './summary.ts';
import type { WriteTransaction } from './transaction.ts';

const COMMIT_BATCH_SIZE = 500;

const countKind = (
  items: readonly ScannedFile[],
  kind: ScannedFile['kind']
): number => items.filter((file) => file.kind === kind).length;

const isTarget = (file: ScannedFile): boolean =>
  file.kind === 'photo' ||
  file.kind === 'raw' ||
  file.kind === 'video' ||
  file.kind === 'xmp';

const sourceKindOf = (file: ScannedFile) =>
  toSourceFileKind(
    file.kind === 'xmp' ? 'xmp' : (file.kind as 'photo' | 'raw' | 'video')
  );

export type ScanRecordInput = {
  db: Database;
  write: WriteTransaction;
  runId: number;
  volumeId: number;
  scan: ScanSummary;
  now: () => Date;
  summary: IngestSummary;
  /** 中断した実行の再開(同じ実行 ID を続ける) */
  resume: boolean;
};

/**
 * スキャンで見つけたファイルを、`source_files` に記録する。解析する行の一覧を返す。
 * - 処理済み(前の実行で、同じボリューム・パス・サイズ・更新日が `done` / `duplicate`)は、記録せず、件数だけ(仕様書 §8-3)
 * - 再開のとき: 同じ実行にある行は、使い回す。終わっているもの(`done` / `duplicate`)は、飛ばす。
 *   それ以外(`scanned` / `analyzed` / `planned` / `error` / `ignored`)は、もう一度、処理する
 * - 対象外(`unsupported`・Takeout の json・ZIP)は、件数だけ
 * 500 件ずつ、まとめてコミットする(仕様書 §17-6)。
 */
export const recordScan = (
  input: ScanRecordInput
): { rows: { file: ScannedFile; sourceFileId: number }[] } => {
  const { db, write, runId, volumeId, scan, summary, resume } = input;
  const rows: { file: ScannedFile; sourceFileId: number }[] = [];
  const at = input.now();
  const targets = scan.files.filter(isTarget);
  summary.unsupported = countKind(scan.files, 'unsupported');
  summary.takeoutJson = countKind(scan.files, 'json');
  summary.archives = countKind(scan.files, 'archive');
  summary.excluded = scan.skipped.length + (scan.archive?.excluded ?? 0);
  summary.zipOpened = scan.archive?.opened ?? 0;

  const count = (file: ScannedFile): void => {
    summary.detected += 1;
    if (file.kind === 'photo') summary.photos += 1;
    else if (file.kind === 'raw') summary.raws += 1;
    else if (file.kind === 'video') summary.videos += 1;
    else summary.sidecars += 1;
  };

  for (let start = 0; start < targets.length; start += COMMIT_BATCH_SIZE) {
    write(() => {
      for (const file of targets.slice(start, start + COMMIT_BATCH_SIZE)) {
        const existing = resume
          ? findSourceFileInRun(db, { runId, volumeId, relPath: file.relPath })
          : undefined;
        if (existing) {
          if (existing.state === 'done' || existing.state === 'duplicate') {
            summary.alreadyDoneInRun += 1;
            continue;
          }
          setSourceFileState(db, existing.sourceFileId, 'scanned');
          rows.push({ file, sourceFileId: existing.sourceFileId });
          count(file);
          continue;
        }
        // 前の実行で、処理済みのものは、スキップする(仕様書 §8-3)
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
        const kind = sourceKindOf(file);
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
        count(file);
      }
    });
  }

  // 空ファイル・読めなかった場所は、エラー一覧に記録する(仕様書 §1-2)。再開で、記録済みの空ファイルは、記録し直さない
  write(() => {
    // ZIP のこと: 暗号化・危険なパス・壊れた ZIP は、エラー。入れ子が深すぎるもの・同じ名前が重なったもの(連番を付けて取り込む)は、警告
    for (const problem of scan.archive?.problems ?? []) {
      if (
        problem.code === 'ZIP_DEPTH_EXCEEDED' ||
        problem.code === 'ZIP_DUPLICATE_ENTRY'
      ) {
        recordEvent(db, {
          runId,
          level: 'WARN',
          code: problem.code,
          message: `${problem.relPath}: ${problem.detail}`,
          occurredAt: at,
        });
        summary.zipWarnings += 1;
        continue;
      }
      recordError(db, {
        runId,
        code: problem.code,
        detail: `${problem.relPath}: ${problem.detail}`,
        occurredAt: at,
      });
      summary.errorsByCode[problem.code] =
        (summary.errorsByCode[problem.code] ?? 0) + 1;
      summary.errorFiles += 1;
    }
    for (const file of scan.emptyFiles) {
      const kind = sourceKindOf(file);
      if (!kind) continue;
      if (
        resume &&
        findSourceFileInRun(db, { runId, volumeId, relPath: file.relPath })
      ) {
        summary.emptyFiles += 1;
        continue;
      }
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
  });
  return { rows };
};

/** 解析と予定から、サマリーの件数を数える */
export const tally = (
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
    // 破損: 修復できたものは、通常の取り込み。直せなかった・試みなかったものは、読み取り不可へ(エラー一覧にも、記録する)
    if (analysis.corruption) {
      summary.corrupted += 1;
      if (analysis.corruption.verdict === 'repaired') summary.repaired += 1;
      else {
        bump(analysis.corruption.code);
        summary.errorFiles += 1;
      }
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
