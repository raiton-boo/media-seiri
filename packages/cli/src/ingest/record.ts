import type { Database } from 'bun:sqlite';
import {
  getMediaMetadata,
  insertDuplicateLink,
  recordError,
  recordEvent,
  setSourceFileContent,
  setSourceFileState,
  upsertMediaMetadata,
} from '@file-seiri/ledger';
import type { FileAnalysis } from './analyze.ts';
import type { IngestPlan } from './plan.ts';

/** まとめてコミットする件数(仕様書 §17-6) */
const COMMIT_BATCH_SIZE = 500;

export type RecordEnvironment = {
  db: Database;
  runId: number;
  now: () => Date;
};

/**
 * 解析と予定の結果を、台帳に記録する(dry-run でも、同じ)。
 * ソースのファイルの内容・状態・エラー・イベントと、内容ごとのメタデータ。ライブラリのファイルは、記録しない(コピー後に記録する)。
 * 500 件ずつ、1 つのトランザクションでまとめてコミットする。
 */
export const recordPlan = (
  environment: RecordEnvironment,
  analyses: readonly FileAnalysis[],
  plan: IngestPlan
): void => {
  const { db, runId, now } = environment;
  const failureByRelPath = new Map(
    plan.failures.map((failure) => [failure.relPath, failure.detail])
  );

  const recordOne = (analysis: FileAnalysis, index: number): void => {
    const { sourceFileId, file } = analysis;
    const filePlan = plan.files[index];
    const at = now();
    const event = (
      level: 'INFO' | 'WARN' | 'ERROR',
      code: string,
      message: string
    ): void => {
      recordEvent(db, {
        runId,
        sourceFileId,
        level,
        code,
        message,
        occurredAt: at,
      });
    };

    if (analysis.content)
      setSourceFileContent(db, sourceFileId, analysis.content.contentId);
    // メタデータは、内容ごとに 1 つ(`.xmp` は、読んでいない)。
    // コピーするファイルは、グループで決めた日付を記録する(同名グループは、全員に同じ日付を当てるため。
    // 名前・置き場所と、台帳の日付・取得元が、食い違わないようにする)。参考の更新日だけは、このファイルのもの。
    // 重複など(グループの外)は、すでにある内容のメタデータを、上書きしない。
    if (analysis.content && file.kind !== 'xmp') {
      const contentId = analysis.content.contentId;
      if (filePlan?.action === 'copy') {
        const groupDate = plan.groupDates[filePlan.groupIndex];
        upsertMediaMetadata(db, {
          contentId,
          date: groupDate
            ? {
                ...groupDate,
                referenceMtime: analysis.resolution.referenceMtime,
              }
            : analysis.resolution,
          ...analysis.details,
        });
      } else if (!getMediaMetadata(db, contentId)) {
        upsertMediaMetadata(db, {
          contentId,
          date: analysis.resolution,
          ...analysis.details,
        });
      }
    }

    if (analysis.metadataError) {
      event(
        'WARN',
        'META_UNREADABLE',
        `${file.relPath}: メタデータを読めません(${analysis.metadataError})。ファイル名などで日付を決めます`
      );
    }
    if (analysis.warning)
      event('WARN', 'META_WARNING', `${file.relPath}: ${analysis.warning}`);
    const failure = failureByRelPath.get(file.relPath);
    if (failure !== undefined) {
      setSourceFileState(db, sourceFileId, 'error');
      recordError(db, {
        runId,
        sourceFileId,
        code: 'COPY_FAILED',
        detail: failure,
        occurredAt: at,
      });
      event('ERROR', 'PLAN_FAILED', `${file.relPath}: ${failure}`);
      return;
    }
    if (analysis.problem) {
      recordError(db, {
        runId,
        sourceFileId,
        code: analysis.problem.code,
        detail: analysis.problem.detail,
        occurredAt: at,
      });
      event(
        'ERROR',
        analysis.problem.code,
        `${file.relPath}: ${analysis.problem.detail}`
      );
    }
    switch (filePlan?.action) {
      case 'copy':
        setSourceFileState(db, sourceFileId, 'planned');
        event(
          'INFO',
          'PLAN_COPY',
          `${file.relPath} → ${filePlan.destinationPath}`
        );
        return;
      case 'duplicate':
        if (filePlan.adoptedLibraryFileId !== undefined) {
          setSourceFileState(db, sourceFileId, 'duplicate');
          insertDuplicateLink(db, {
            skippedSourceFileId: sourceFileId,
            adoptedLibraryFileId: filePlan.adoptedLibraryFileId,
            createdAt: at,
          });
          event(
            'INFO',
            'PLAN_DUPLICATE',
            `${file.relPath}(ライブラリに、同じ内容がある)`
          );
        } else {
          // この実行の中の重複。採用側は、まだライブラリにないため、対応(duplicate_links)は、コピーのあとに記録する
          setSourceFileState(
            db,
            sourceFileId,
            'duplicate',
            `採用予定: ${filePlan.adoptedPlannedRelPath}`
          );
          event(
            'INFO',
            'PLAN_DUPLICATE',
            `${file.relPath}(この実行の ${filePlan.adoptedPlannedRelPath} と同じ内容)`
          );
        }
        return;
      case 'orphan-sidecar':
        setSourceFileState(
          db,
          sourceFileId,
          'ignored',
          'RAW のない .xmp(コピーしない)'
        );
        event('INFO', 'PLAN_IGNORED', `${file.relPath}(RAW のない .xmp)`);
        return;
      default:
        setSourceFileState(db, sourceFileId, 'error');
    }
  };

  for (let start = 0; start < analyses.length; start += COMMIT_BATCH_SIZE) {
    db.transaction(() => {
      for (
        let index = start;
        index < Math.min(start + COMMIT_BATCH_SIZE, analyses.length);
        index += 1
      ) {
        recordOne(analyses[index] as FileAnalysis, index);
      }
    })();
  }
};
