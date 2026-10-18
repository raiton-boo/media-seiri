import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ScannedFile, ScanSummary } from '../scan/scan.ts';
import {
  type ArchiveContext,
  type ArchiveProblem,
  expandArchive,
  TEMP_PREFIX,
  TEMP_SUFFIX,
} from './expand.ts';

export {
  type ArchiveContext,
  type ArchiveProblem,
  DEFAULT_MAX_ENTRY_BYTES,
  MAX_ZIP_DEPTH,
  problemFor,
} from './expand.ts';
export { ZipExtractError } from './zip-reader.ts';

/**
 * スキャンの結果の、ZIP を開いて、中のファイルを足す(ZIP の直後に、中の並びの順で)。
 * 開けなかった・危険・暗号化・深すぎるものは、`archive.problems` に入れる(ほかの中身は、続ける)。
 */
export const expandArchives = async (
  scan: ScanSummary,
  context: ArchiveContext
): Promise<ScanSummary> => {
  const files: ScannedFile[] = [];
  const emptyFiles: ScannedFile[] = [...scan.emptyFiles];
  const problems: ArchiveProblem[] = [];
  let opened = 0;
  let excluded = 0;
  for (const file of scan.files) {
    files.push(file);
    if (file.kind !== 'archive') continue;
    const expanded = await expandArchive(file, context);
    files.push(...expanded.files);
    emptyFiles.push(...expanded.emptyFiles);
    problems.push(...expanded.problems);
    opened += expanded.opened;
    excluded += expanded.excluded;
  }
  return {
    ...scan,
    files,
    emptyFiles,
    archive: { problems, opened, excluded },
  };
};

/** 前の実行の残りの、取り出しかけのファイルを、消す(次の起動で、掃除する) */
export const cleanupArchiveTemp = (tmpDir: string): number => {
  let removed = 0;
  let names: string[];
  try {
    names = readdirSync(tmpDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name.startsWith(TEMP_PREFIX) && name.endsWith(TEMP_SUFFIX)) {
      rmSync(join(tmpDir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
};
