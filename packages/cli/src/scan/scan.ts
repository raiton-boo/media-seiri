import { type Dirent, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  classifyFile,
  extensionOf,
  type FileKind,
  isExcludedName,
} from '@file-seiri/core';
import type { ArchiveProblem } from '../archive/expand.ts';
import { CliError } from '../cli-error.ts';
import { relativeToVolume, type VolumeInfo } from '../volume/index.ts';

/** ZIP(中身は、PR 7 で開く)。`FileKind` にない種類 */
export const ARCHIVE_EXTENSION = 'zip';

export type ScanKind = FileKind | 'archive';

/** ZIP の中のファイルを、一時領域に取り出したもの。使い終わったら、`cleanup` で、消す */
export type Materialized = {
  path: string;
  cleanup: () => Promise<void>;
};

export type ScannedFile = {
  /**
   * ZIP の中のファイルは、使うときに、一時領域へ 1 ファイルだけ取り出す(`materializeFile`)。通常のファイルは、なし。
   * ZIP の中のファイルの `absolutePath` は、実在しない、表示用のパス(`/…/a.zip!/inner/b.jpg`)。
   */
  materialize?: () => Promise<Materialized>;
  absolutePath: string;
  /** ボリューム内の相対パス(`/` 区切り)。台帳の `rel_path` */
  relPath: string;
  /** ソースのフォルダからの、フォルダ(`/` 区切り)。ソースの直下は、空の文字列。同名グループの範囲 */
  directory: string;
  fileName: string;
  /** 小文字の拡張子(ドットなし) */
  ext: string;
  kind: ScanKind;
  sizeBytes: number;
  mtimeMs: number;
};

export type SkipReason =
  // 管理用のファイル・フォルダ、`._*`、`*.photoslibrary`(仕様書 §1-2)
  | 'excluded-name'
  // ライブラリの根・作業用の `data/`(出力先を、再スキャンしないため)
  | 'excluded-path'
  // シンボリックリンクは、たどらない(輪になる・ソースの外を取り込むのを避けるため)
  | 'symlink'
  // 通常のファイル・フォルダではないもの(デバイス・ソケットなど)
  | 'special';

export type ScanEvent =
  | { type: 'file'; file: ScannedFile }
  // 0 バイトのファイル。エラー一覧に、空ファイル(EMPTY_FILE)として記録する
  | { type: 'empty-file'; file: ScannedFile }
  | { type: 'skipped'; relPath: string; reason: SkipReason }
  // 読めなかったもの(権限など)。記録して、続ける(READ_FAILED)
  | { type: 'unreadable'; relPath: string; detail: string };

export type ScanOptions = {
  /** ソースのフォルダ(実在する絶対パス) */
  sourceRoot: string;
  volume: VolumeInfo;
  /** たどらない場所(ライブラリの根・`data/`)の絶対パス */
  excludePaths?: readonly string[];
  /** 設定で足した拡張子(仕様書 §1-1) */
  additionalExtensions?: ReadonlyMap<string, FileKind>;
};

const compareNames = (a: Dirent, b: Dirent): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * ソースのフォルダを、たどる。ファイルを 1 つずつ返す(取り込みの表示を、すぐに更新できるように)。
 * 並びは、名前の順(同じソースは、いつも同じ順になる)。フォルダは、ファイルより先に、深さ優先でたどる。
 */
export function* scanSource(options: ScanOptions): Generator<ScanEvent> {
  const sourceRoot = resolve(options.sourceRoot);
  const excluded = new Set(
    (options.excludePaths ?? []).map((path) => resolve(path))
  );
  const additional =
    options.additionalExtensions ?? new Map<string, FileKind>();
  if (excluded.has(sourceRoot)) {
    throw new CliError(`ソースが、除外する場所と同じです: ${sourceRoot}`);
  }

  function* walk(
    directory: string,
    directoryRel: string
  ): Generator<ScanEvent> {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      yield {
        type: 'unreadable',
        relPath: relativeToVolume(options.volume, directory),
        detail: messageOf(error),
      };
      return;
    }
    entries.sort(compareNames);

    // フォルダを先にたどり、そのあとファイル(どちらも、名前の順)
    const directories = entries.filter((entry) => entry.isDirectory());
    const others = entries.filter((entry) => !entry.isDirectory());
    for (const entry of [...directories, ...others]) {
      const absolutePath = join(directory, entry.name);
      const relPath = relativeToVolume(options.volume, absolutePath);

      if (isExcludedName(entry.name)) {
        yield { type: 'skipped', relPath, reason: 'excluded-name' };
        continue;
      }
      if (excluded.has(absolutePath)) {
        yield { type: 'skipped', relPath, reason: 'excluded-path' };
        continue;
      }
      if (entry.isSymbolicLink()) {
        yield { type: 'skipped', relPath, reason: 'symlink' };
        continue;
      }
      if (entry.isDirectory()) {
        yield* walk(
          absolutePath,
          directoryRel === '' ? entry.name : `${directoryRel}/${entry.name}`
        );
        continue;
      }
      if (!entry.isFile()) {
        yield { type: 'skipped', relPath, reason: 'special' };
        continue;
      }

      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(absolutePath);
      } catch (error) {
        yield { type: 'unreadable', relPath, detail: messageOf(error) };
        continue;
      }
      const ext = extensionOf(entry.name);
      const file: ScannedFile = {
        absolutePath,
        relPath,
        directory: directoryRel,
        fileName: entry.name,
        ext,
        kind:
          ext === ARCHIVE_EXTENSION
            ? 'archive'
            : classifyFile(entry.name, additional),
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
      };
      yield { type: stats.size === 0 ? 'empty-file' : 'file', file };
    }
  }

  yield* walk(sourceRoot, '');
}

export type ScanSummary = {
  files: ScannedFile[];
  /** ZIP を開いた結果(`expandArchives` のあと。開かなければ、なし) */
  archive?: {
    problems: ArchiveProblem[];
    opened: number;
    excluded: number;
  };
  emptyFiles: ScannedFile[];
  skipped: Extract<ScanEvent, { type: 'skipped' }>[];
  unreadable: Extract<ScanEvent, { type: 'unreadable' }>[];
};

/** スキャンの全体を、集める(件数の見積り・dry-run 用) */
export const collectScan = (options: ScanOptions): ScanSummary => {
  const summary: ScanSummary = {
    files: [],
    emptyFiles: [],
    skipped: [],
    unreadable: [],
  };
  for (const event of scanSource(options)) {
    if (event.type === 'file') summary.files.push(event.file);
    else if (event.type === 'empty-file') summary.emptyFiles.push(event.file);
    else if (event.type === 'skipped') summary.skipped.push(event);
    else summary.unreadable.push(event);
  }
  return summary;
};
