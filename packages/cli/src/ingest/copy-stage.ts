import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ErrorCode } from '@file-seiri/core';
import {
  insertDuplicateLink,
  insertFileGroup,
  insertLibraryFile,
  LockLostError,
  listLibraryFilesByContent,
  recordError,
  recordEvent,
  setSourceFileState,
  type WriteLock,
} from '@file-seiri/ledger';
import { ZipExtractError } from '../archive/index.ts';
import type { CommandContext } from '../context.ts';
import {
  CopyError,
  copyVerified,
  DestinationExistsError,
  usesAppleDouble,
} from '../copy/index.ts';
import { SourceChangedError } from '../hash/index.ts';
import { materializeFile } from '../scan/index.ts';
import type { VolumeInfo } from '../volume/index.ts';
import type { FileAnalysis } from './analyze.ts';
import { COPY_START, encodeCopyIntent } from './copy-events.ts';
import type { OpenedLibrary } from './library.ts';
import type { IngestPlan } from './plan.ts';
import type { CopyResult, IngestSummary, StopReason } from './summary.ts';

/** コピーの進みを、表示する間隔(ファイル数) */
const PROGRESS_INTERVAL = 50;

/** テストで、処理の途中に、割り込むための差し込み口 */
export type IngestHooks = {
  /** 1 ファイルを、コピーして記録したあと(`copied`: ここまでにコピーした数) */
  afterFileCopied?: (copied: number) => void | Promise<void>;
};

export type CopyStageInput = {
  context: CommandContext;
  library: OpenedLibrary;
  lock: WriteLock;
  runId: number;
  sourceRoot: string;
  destinationVolume: VolumeInfo;
  analyses: readonly FileAnalysis[];
  plan: IngestPlan;
  summary: IngestSummary;
};

type Failure = { code: ErrorCode; detail: string; fatal?: StopReason };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** コピーの失敗を、エラーのコードと、続けられるかに分ける */
const classify = (error: unknown): Failure => {
  if (error instanceof ZipExtractError)
    return {
      code: error.kind === 'encrypted' ? 'ZIP_ENCRYPTED' : 'READ_FAILED',
      detail: error.message,
    };
  if (error instanceof LockLostError)
    return { code: 'COPY_FAILED', detail: error.message, fatal: 'lock-lost' };
  if (error instanceof SourceChangedError)
    return { code: 'READ_FAILED', detail: error.message };
  if (error instanceof DestinationExistsError)
    return { code: 'COPY_FAILED', detail: error.message };
  if (error instanceof CopyError) {
    const cause = (error.cause as { code?: string } | undefined)?.code;
    const detail = error.cause
      ? `${error.message}(${messageOf(error.cause)})`
      : error.message;
    // 容量がなくなったら、あとのファイルも、すべて失敗するため、そこで止める
    return {
      code: error.code,
      detail,
      ...(cause === 'ENOSPC' ? { fatal: 'disk-full' as const } : {}),
    };
  }
  return { code: 'COPY_FAILED', detail: messageOf(error) };
};

/**
 * 計画したコピーを、1 件ずつ、順番に実行する(HDD の保存先に、並列で書かない。仕様書 §17-3)。
 *
 * 1 ファイルごとに:
 *   1. `COPY_START`(意図)を記録する → 2. 整合性を守ってコピーする(`copyVerified`)
 *   → 3. `library_files`・状態 `done`・イベントを、1 つのトランザクションで記録する。
 * ファイルが先で、台帳が後。2 と 3 の間で止まっても、次の起動で、`COPY_START` から見つけて採用する(`recover.ts`)。
 * 書き込みは、すべて、ロックの保持者を確かめるトランザクションを通す(ロックを失ったら、止まる)。
 * 失敗したファイルは、エラーとして記録して、続ける。ただし、ロックを失った・容量がなくなった・ドライブが抜けたときは、止める。
 * 同じ実行の中の重複は、採用側のコピーが終わったあとで、結びつける(採用側が失敗していたら、その重複も、取り込めていない)。
 * @returns 止まった理由(最後まで終わったときは、undefined)
 */
export const executeCopies = async (
  input: CopyStageInput
): Promise<StopReason | undefined> => {
  const {
    context,
    library,
    lock,
    runId,
    sourceRoot,
    destinationVolume,
    analyses,
    plan,
    summary,
  } = input;
  const { db } = library.ledger;
  const result: CopyResult = {
    copied: 0,
    copiedBytes: 0,
    failed: 0,
    linkedDuplicates: 0,
    stopReason: undefined,
  };
  summary.copy = result;
  const removeAppleDouble = usesAppleDouble(destinationVolume.fsType);

  // コピーの順: スキャンの順(グループは、最初のメンバーの位置)。1 グループずつ、続けて
  const order: number[] = [];
  const groupMembers = new Map<number, number[]>();
  analyses.forEach((_, index) => {
    const filePlan = plan.files[index];
    if (filePlan?.action !== 'copy') return;
    const members = groupMembers.get(filePlan.groupIndex);
    if (members) members.push(index);
    else {
      groupMembers.set(filePlan.groupIndex, [index]);
      order.push(filePlan.groupIndex);
    }
  });

  const groupIds = new Map<number, number>();
  const stopReason = (): StopReason | undefined => {
    if (lock.isLost()) return 'lock-lost';
    return context.shouldStop() ? 'user' : undefined;
  };
  const finish = (reason: StopReason | undefined): StopReason | undefined => {
    result.stopReason = reason;
    return reason;
  };
  const total = order.reduce(
    (sum, groupIndex) => sum + (groupMembers.get(groupIndex)?.length ?? 0),
    0
  );

  for (const groupIndex of order) {
    for (const index of groupMembers.get(groupIndex) ?? []) {
      const stopped = stopReason();
      if (stopped) return finish(stopped);

      const analysis = analyses[index] as FileAnalysis;
      const filePlan = plan.files[index];
      if (filePlan?.action !== 'copy' || !analysis.content) continue;
      const { file, sourceFileId } = analysis;
      const destination = join(library.root, filePlan.destinationPath);
      const group = plan.groups[groupIndex];
      const at = (): Date => context.now();

      try {
        lock.transaction(() => {
          recordEvent(db, {
            runId,
            sourceFileId,
            // 書き込みの先行記録は、利用者には、雑音。通常の表示(INFO 以上)には、出さない
            level: 'DEBUG',
            code: COPY_START,
            message: encodeCopyIntent({
              src: file.relPath,
              dest: filePlan.destinationPath,
              hash: (analysis.content as { hash: string }).hash,
              sizeBytes: file.sizeBytes,
              stem: group?.stem ?? file.fileName,
              bucket: filePlan.bucket,
            }),
            occurredAt: at(),
          });
        });
        // ZIP の中のファイルは、ここで、一時領域に取り出して、コピーし、すぐ消す
        const materialized = await materializeFile(file);
        try {
          await copyVerified({
            sourcePath: materialized.path,
            destinationPath: destination,
            expected: {
              sizeBytes: file.sizeBytes,
              mtimeMs: file.mtimeMs,
              hash: analysis.content.hash,
            },
            removeAppleDouble,
          });
        } finally {
          await materialized.cleanup();
        }
        lock.transaction(() => {
          let groupId = groupIds.get(groupIndex);
          if (groupId === undefined) {
            groupId = insertFileGroup(db, {
              stem: group?.stem ?? file.fileName,
              bucket: filePlan.bucket,
            });
            groupIds.set(groupIndex, groupId);
          }
          insertLibraryFile(db, {
            contentId: (analysis.content as { contentId: number }).contentId,
            groupId,
            runId,
            relPath: filePlan.destinationPath,
            bucket: filePlan.bucket,
            isRepaired: analysis.corruption?.verdict === 'repaired',
            createdAt: at(),
          });
          setSourceFileState(db, sourceFileId, 'done');
          recordEvent(db, {
            runId,
            sourceFileId,
            level: 'INFO',
            code: 'COPIED',
            message: `${file.relPath} → ${filePlan.destinationPath}`,
            occurredAt: at(),
          });
        });
        result.copied += 1;
        result.copiedBytes += file.sizeBytes;
        if (result.copied % PROGRESS_INTERVAL === 0)
          context.stdout(`  コピー: ${result.copied} / ${total}`);
        await context.ingestHooks?.afterFileCopied?.(result.copied);
      } catch (error) {
        const failure = classify(error);
        if (failure.fatal === 'lock-lost') return finish('lock-lost');
        try {
          lock.transaction(() => {
            setSourceFileState(db, sourceFileId, 'error');
            recordError(db, {
              runId,
              sourceFileId,
              code: failure.code,
              detail: failure.detail,
              occurredAt: at(),
            });
            recordEvent(db, {
              runId,
              sourceFileId,
              level: 'ERROR',
              code: failure.code,
              message: `${file.relPath}: ${failure.detail}`,
              occurredAt: at(),
            });
          });
        } catch (recordFailure) {
          if (recordFailure instanceof LockLostError)
            return finish('lock-lost');
          throw recordFailure;
        }
        result.failed += 1;
        summary.errorsByCode[failure.code] =
          (summary.errorsByCode[failure.code] ?? 0) + 1;
        summary.errorFiles += 1;
        if (failure.fatal) return finish(failure.fatal);
        // ドライブが抜けたら、あとのファイルも、すべて失敗する。エラーを重ねず、中断する
        if (!existsSync(sourceRoot) || !existsSync(library.root))
          return finish('drive-removed');
      }
    }
  }

  // 今回の中の重複: 採用側のコピーが終わったので、結びつける。採用側が失敗していたら、取り込めていない(次の実行で、再度の対象)
  for (const [index, analysis] of analyses.entries()) {
    const filePlan = plan.files[index];
    if (
      filePlan?.action !== 'duplicate' ||
      filePlan.adoptedLibraryFileId !== undefined
    )
      continue;
    if (!analysis.content) continue;
    const stopped = stopReason();
    if (stopped) return finish(stopped);
    const adopted = listLibraryFilesByContent(
      db,
      analysis.content.contentId
    )[0];
    try {
      lock.transaction(() => {
        const { sourceFileId, file } = analysis;
        if (adopted) {
          setSourceFileState(db, sourceFileId, 'duplicate');
          insertDuplicateLink(db, {
            skippedSourceFileId: sourceFileId,
            adoptedLibraryFileId: adopted.libraryFileId,
            createdAt: context.now(),
          });
          recordEvent(db, {
            runId,
            sourceFileId,
            level: 'INFO',
            code: 'DUPLICATE_LINKED',
            message: `${file.relPath}(${adopted.relPath} と同じ内容)`,
            occurredAt: context.now(),
          });
        } else {
          const detail = `採用側(${filePlan.adoptedPlannedRelPath})のコピーが失敗したため、取り込めませんでした`;
          setSourceFileState(db, sourceFileId, 'error');
          recordError(db, {
            runId,
            sourceFileId,
            code: 'COPY_FAILED',
            detail,
            occurredAt: context.now(),
          });
          recordEvent(db, {
            runId,
            sourceFileId,
            level: 'ERROR',
            code: 'COPY_FAILED',
            message: `${file.relPath}: ${detail}`,
            occurredAt: context.now(),
          });
        }
      });
    } catch (error) {
      if (error instanceof LockLostError) return finish('lock-lost');
      throw error;
    }
    if (adopted) result.linkedDuplicates += 1;
    else {
      result.failed += 1;
      summary.errorsByCode.COPY_FAILED =
        (summary.errorsByCode.COPY_FAILED ?? 0) + 1;
      summary.errorFiles += 1;
    }
  }
  return finish(undefined);
};
