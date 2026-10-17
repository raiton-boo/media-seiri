import type { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Bucket,
  buildPlacement,
  choosePlacements,
  type DateResolution,
  type FileGroup,
  groupFiles,
  placementPath,
  resolveGroupDate,
  type SourceFile,
} from '@file-seiri/core';
import {
  libraryPathExists,
  listLibraryFilesByContent,
} from '@file-seiri/ledger';
import type { FileAnalysis } from './analyze.ts';

/** 1 ファイルの扱いの予定 */
export type FilePlan =
  | {
      action: 'copy';
      /** ライブラリの根からの、保存先のパス(`/` 区切り) */
      destinationPath: string;
      bucket: Bucket;
      /** 同名グループの番号(`groups` の添字)。RAW+JPEG などは、同じ番号 */
      groupIndex: number;
    }
  | {
      action: 'duplicate';
      /** ライブラリにすでにある採用側。この実行の中の重複のときは、undefined */
      adoptedLibraryFileId: number | undefined;
      /** この実行の中の重複のとき、先に採用する予定のファイルの相対パス */
      adoptedPlannedRelPath: string | undefined;
    }
  // RAW を取り込まない(重複・エラー)ため、隣にコピーしない `.xmp`
  | { action: 'skip-sidecar'; reason: string }
  // RAW のない `.xmp`(コピーしない)
  | { action: 'orphan-sidecar' }
  | { action: 'error' };

export type GroupPlan = {
  /** 出力名の語幹と、置き場所の区分(`file_groups` に記録する) */
  stem: string;
  bucket: Bucket;
};

export type IngestPlan = {
  /** `analyses` と同じ並びの、扱いの予定 */
  files: FilePlan[];
  groups: GroupPlan[];
  /** グループの日付の決定の結果(グループの番号ごと) */
  groupDates: DateResolution[];
  /** 名前の衝突を避けるために、連番を付けたグループの数 */
  sequencedGroups: number;
  /** グループを作れなかった(同じ名前になるメンバーがいる)など、予想外の失敗 */
  failures: { relPath: string; detail: string }[];
};

export type PlanEnvironment = {
  db: Database;
  /** ライブラリの根(保存先に実在するファイルとの衝突を確かめる) */
  libraryRoot: string;
};

const CASE_INSENSITIVE = (path: string): string => path.toLowerCase();

/** 内容が、ライブラリにあるか・この実行の先のファイルと同じかで、重複を決める(ファイルの並びの順に、先のものを採用) */
const decideDuplicates = (
  analyses: readonly FileAnalysis[],
  db: Database
): Map<number, FilePlan & { action: 'duplicate' }> => {
  const duplicates = new Map<number, FilePlan & { action: 'duplicate' }>();
  const plannedByContent = new Map<number, string>();
  analyses.forEach((analysis, index) => {
    if (!analysis.content || analysis.problem?.code === 'READ_FAILED') return;
    // `.xmp` は、重複にしない(中身が同じでも、それぞれの RAW の隣にコピーするため)
    if (analysis.file.kind === 'xmp') return;
    const contentId = analysis.content.contentId;
    const adopted = listLibraryFilesByContent(db, contentId)[0];
    if (adopted) {
      duplicates.set(index, {
        action: 'duplicate',
        adoptedLibraryFileId: adopted.libraryFileId,
        adoptedPlannedRelPath: undefined,
      });
      return;
    }
    const planned = plannedByContent.get(contentId);
    if (planned !== undefined) {
      duplicates.set(index, {
        action: 'duplicate',
        adoptedLibraryFileId: undefined,
        adoptedPlannedRelPath: planned,
      });
      return;
    }
    plannedByContent.set(contentId, analysis.file.relPath);
  });
  return duplicates;
};

/**
 * 解析の結果から、取り込みの予定を作る(コピーはしない)。
 * 1. 重複(台帳全体と、この実行の中)を決める
 * 2. 同じフォルダ・同じ語幹のファイルを、グループにする(読めなかったもの・エラーのものは、除く)
 * 3. グループの日付を、1 回だけ決める。置き場所と名前を決め、衝突したら、連番を取り直す
 *    (衝突 = 台帳にある・この実行で予約した・保存先に実在する。大文字小文字は、区別しない)
 * 4. 読めなかったもの(`unreadable`)は、1 つずつ `_unknown/読み取り不可/` に置く
 * 解析の並びが同じなら、予定も、いつも同じになる。
 */
export const buildPlan = (
  analyses: readonly FileAnalysis[],
  environment: PlanEnvironment
): IngestPlan => {
  const files: FilePlan[] = analyses.map(() => ({ action: 'error' }));
  const groups: GroupPlan[] = [];
  const groupDates: DateResolution[] = [];
  const failures: IngestPlan['failures'] = [];
  let sequencedGroups = 0;

  const duplicates = decideDuplicates(analyses, environment.db);
  const indexByRelPath = new Map(
    analyses.map((analysis, index) => [analysis.file.relPath, index])
  );
  const reserved = new Set<string>();
  const isTaken = (path: string): boolean =>
    reserved.has(CASE_INSENSITIVE(path)) ||
    libraryPathExists(environment.db, path) ||
    existsSync(join(environment.libraryRoot, path));
  const reserve = (path: string): void => {
    reserved.add(CASE_INSENSITIVE(path));
  };

  // グループに入れるもの: 読めて、エラーがなく、重複でないもの(`.xmp` は、あとで RAW に従う)
  const groupable: SourceFile[] = [];
  analyses.forEach((analysis, index) => {
    if (analysis.problem?.code === 'READ_FAILED') return;
    if (analysis.unreadable) return;
    if (duplicates.has(index) && analysis.file.kind !== 'xmp') return;
    groupable.push({
      id: analysis.file.relPath,
      directory: analysis.file.directory,
      fileName: analysis.file.fileName,
    });
  });
  const grouping = groupFiles(groupable);
  for (const orphan of grouping.orphanSidecars) {
    const index = indexByRelPath.get(orphan.id);
    if (index !== undefined) files[index] = { action: 'orphan-sidecar' };
  }

  for (const [index, duplicate] of duplicates) files[index] = duplicate;

  const placeGroup = (group: FileGroup): void => {
    const resolutions = new Map<string, DateResolution>();
    for (const member of group.members) {
      const index = indexByRelPath.get(member.file.id);
      if (index !== undefined)
        resolutions.set(
          member.file.id,
          (analyses[index] as FileAnalysis).resolution
        );
    }
    const date = resolveGroupDate(group, resolutions);
    const placed = choosePlacements(group, date, isTaken);
    if (placed.sequence !== undefined) sequencedGroups += 1;
    const groupIndex = groups.length;
    groups.push({
      stem: date.representative.stem,
      bucket: (placed.placements[0] as (typeof placed.placements)[number])
        .placement.bucket,
    });
    groupDates.push(date.resolution);
    for (const entry of placed.placements) {
      const index = indexByRelPath.get(entry.file.id);
      if (index === undefined) continue;
      const destinationPath = placementPath(entry.placement);
      reserve(destinationPath);
      files[index] = {
        action: 'copy',
        destinationPath,
        bucket: entry.placement.bucket,
        groupIndex,
      };
    }
  };

  for (const group of grouping.groups) {
    try {
      placeGroup(group);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      for (const member of group.members)
        failures.push({ relPath: member.file.id, detail });
    }
  }

  // 読めなかったもの: 1 つずつ、`_unknown/読み取り不可/` に置く
  analyses.forEach((analysis, index) => {
    if (!analysis.unreadable || analysis.problem?.code === 'READ_FAILED')
      return;
    if (duplicates.has(index)) return;
    for (
      let sequence = undefined as number | undefined;
      ;
      sequence = (sequence ?? 0) + 1
    ) {
      const placement = buildPlacement(
        { kind: 'unknown', reason: 'unreadable' },
        analysis.file.fileName,
        sequence
      );
      const path = placementPath(placement);
      if (isTaken(path)) continue;
      reserve(path);
      const groupIndex = groups.length;
      groups.push({ stem: analysis.file.fileName, bucket: placement.bucket });
      groupDates.push(analysis.resolution);
      files[index] = {
        action: 'copy',
        destinationPath: path,
        bucket: placement.bucket,
        groupIndex,
      };
      if (sequence !== undefined) sequencedGroups += 1;
      return;
    }
  });

  return { files, groups, groupDates, sequencedGroups, failures };
};
