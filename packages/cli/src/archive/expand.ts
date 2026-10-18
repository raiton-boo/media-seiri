import { mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyFile,
  type ErrorCode,
  extensionOf,
  type FileKind,
  isExcludedName,
} from '@file-seiri/core';
import type { Materialized, ScannedFile } from '../scan/scan.ts';
import { safeSegments } from './zip-names.ts';
import {
  extractZipEntry,
  readZipEntries,
  type ZipEntry,
  ZipExtractError,
  ZipReadError,
} from './zip-reader.ts';

/** 一時ファイルの名前(前の実行の残りを、起動時に、見つけて消すため) */
export const TEMP_PREFIX = 'zip-';
export const TEMP_SUFFIX = '.part';

/** ZIP の入れ子を、開く深さ(ディスク上の ZIP が 1)。これより深いものは、開かず、警告にする */
export const MAX_ZIP_DEPTH = 3;
/** 1 エントリの、展開後の上限の既定(バイト)。異常に大きいものは、エラーにする */
export const DEFAULT_MAX_ENTRY_BYTES = 32 * 1024 ** 3;

export type ArchiveContext = {
  /** 取り出し先の一時領域(`data/libraries/<ID>/tmp/`)。なければ、作る */
  tmpDir: string;
  maxDepth: number;
  maxEntryBytes: number;
  additionalExtensions?: ReadonlyMap<string, FileKind>;
};

/** ZIP を開くときに起きた問題。`ZIP_DEPTH_EXCEEDED`・`ZIP_DUPLICATE_ENTRY` だけが、警告(ほかは、エラー) */
export type ArchiveProblem = {
  code: Extract<
    ErrorCode,
    | 'ZIP_ENCRYPTED'
    | 'ZIP_UNSAFE_PATH'
    | 'ZIP_DEPTH_EXCEEDED'
    | 'ZIP_DUPLICATE_ENTRY'
    | 'READ_FAILED'
  >;
  /** 問題のあった場所(`a.zip!/inner/b.jpg` の形) */
  relPath: string;
  detail: string;
};

export type ExpandResult = {
  /** ZIP の中のファイル(写真・動画・RAW・サイドカー・json・対象外・入れ子の ZIP)。ZIP の中の並びの順 */
  files: ScannedFile[];
  /** 0 バイトのファイル */
  emptyFiles: ScannedFile[];
  problems: ArchiveProblem[];
  /** 管理用の名前(`._*` など)で、除いたエントリの数 */
  excluded: number;
  /** 開いた ZIP の数(入れ子を含む) */
  opened: number;
};

let counter = 0;
const tempPathIn = (tmpDir: string): string => {
  counter += 1;
  return join(tmpDir, `${TEMP_PREFIX}${process.pid}-${counter}${TEMP_SUFFIX}`);
};

/**
 * ZIP の中のエントリを、一時領域へ取り出す(入れ子なら、外側から順に。取り出した外側は、すぐ消す)。
 * 取り出したファイルの更新日は、ZIP に記録された日にそろえる(ハッシュの前後の、変更の検出のため)。
 */
const materializeChain = async (
  outerPath: string,
  chain: readonly ZipEntry[],
  mtimeMs: number,
  context: ArchiveContext
): Promise<Materialized> => {
  mkdirSync(context.tmpDir, { recursive: true });
  let current = outerPath;
  let currentIsTemp = false;
  const temps: string[] = [];
  try {
    for (const entry of chain) {
      const out = tempPathIn(context.tmpDir);
      temps.push(out);
      await extractZipEntry(current, entry, out, {
        maxBytes: context.maxEntryBytes,
      });
      if (currentIsTemp) rmSync(current, { force: true });
      current = out;
      currentIsTemp = true;
    }
    utimesSync(current, mtimeMs / 1000, mtimeMs / 1000);
  } catch (error) {
    for (const temp of temps) rmSync(temp, { force: true });
    throw error;
  }
  const final = current;
  return {
    path: final,
    cleanup: async () => {
      rmSync(final, { force: true });
    },
  };
};

/** `name.ext` の、拡張子の前に、` (番号)` を入れる(拡張子がなければ、末尾) */
const withNumber = (name: string, ext: string, number: number): string =>
  ext !== '' && name.toLowerCase().endsWith(`.${ext}`)
    ? `${name.slice(0, -(ext.length + 1))} (${number}).${name.slice(-ext.length)}`
    : `${name} (${number})`;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * ZIP を開いて、中のファイルを、`ScannedFile` にして返す(取り出さない。一覧だけ)。
 * 入れ子の ZIP は、一時領域に取り出して一覧を読み、すぐ消す(深さ `maxDepth` まで)。
 * 暗号化・危険なパス・壊れた ZIP・深すぎる入れ子は、問題として返す(ほかの中身は、続けて処理する)。
 */
export const expandArchive = async (
  zipFile: ScannedFile,
  context: ArchiveContext
): Promise<ExpandResult> => {
  // この ZIP(入れ子を含む)の中で、使った仮想パス。重なったら、連番を付ける
  const seenPaths = new Set<string>();
  const result: ExpandResult = {
    files: [],
    emptyFiles: [],
    problems: [],
    excluded: 0,
    opened: 0,
  };

  const visit = async (
    archive: ScannedFile,
    outerPath: string,
    chain: readonly ZipEntry[],
    depth: number
  ): Promise<void> => {
    // 一覧を読む: 外側のディスク上の ZIP は、そのまま。入れ子は、一時領域に出して読み、すぐ消す
    let listPath = outerPath;
    let cleanup: (() => Promise<void>) | undefined;
    if (chain.length > 0) {
      try {
        const materialized = await materializeChain(
          outerPath,
          chain,
          archive.mtimeMs,
          context
        );
        listPath = materialized.path;
        cleanup = materialized.cleanup;
      } catch (error) {
        result.problems.push(problemFor(error, archive.relPath));
        return;
      }
    }
    let entries: ZipEntry[];
    try {
      result.opened += 1;
      try {
        entries = readZipEntries(listPath);
      } catch (error) {
        if (error instanceof ZipReadError && error.partial.length > 0) {
          // 壊れているが、読めたところまでは、処理する
          entries = error.partial;
          result.problems.push({
            code: 'READ_FAILED',
            relPath: archive.relPath,
            detail: `ZIP が壊れています(読めたところまでを処理します): ${error.message}`,
          });
        } else {
          result.problems.push({
            code: 'READ_FAILED',
            relPath: archive.relPath,
            detail: `ZIP を開けません: ${messageOf(error)}`,
          });
          return;
        }
      }
    } finally {
      await cleanup?.();
    }

    const directoryOfArchive = archive.directory
      ? `${archive.directory}/${archive.fileName}!`
      : `${archive.fileName}!`;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const virtualRel = `${archive.relPath}!/${entry.name}`;
      if (entry.encrypted) {
        result.problems.push({
          code: 'ZIP_ENCRYPTED',
          relPath: virtualRel,
          detail: '暗号化されているため、開けません(スキップします)',
        });
        continue;
      }
      const safe = safeSegments(entry.name);
      if (!safe.ok) {
        result.problems.push({
          code: 'ZIP_UNSAFE_PATH',
          relPath: virtualRel,
          detail: `危険なパスのため、展開しません: ${safe.reason}`,
        });
        continue;
      }
      if (safe.segments.some((segment) => isExcludedName(segment))) {
        result.excluded += 1;
        continue;
      }
      const innerSegments = safe.segments.slice(0, -1);
      const originalName = safe.segments[safe.segments.length - 1] as string;
      const ext = extensionOf(originalName);
      // 同じ名前のファイルが、ZIP の中に複数あるとき(名前の正規化で重なる場合も)は、連番を付けて、すべて取り込む。
      // 台帳の「同じ実行の、同じパス」は、1 件だけなので、そのままでは、記録できない
      const pathOf = (name: string): string =>
        `${archive.relPath}!/${[...innerSegments, name].join('/')}`;
      let fileName = originalName;
      for (let number = 2; seenPaths.has(pathOf(fileName)); number += 1) {
        fileName = withNumber(originalName, ext, number);
      }
      const relPath = pathOf(fileName);
      seenPaths.add(relPath);
      if (fileName !== originalName) {
        result.problems.push({
          code: 'ZIP_DUPLICATE_ENTRY',
          relPath: pathOf(originalName),
          detail: `同じ名前のファイルが、複数あるため、名前に連番を付けて取り込みます(${fileName})`,
        });
      }
      const innerDirectory = innerSegments.join('/');
      const isArchive = ext === 'zip';
      const entryChain = [...chain, entry];
      const mtimeMs = Math.round(entry.mtimeMs);
      const file: ScannedFile = {
        absolutePath: `${archive.absolutePath}!/${[...innerSegments, fileName].join('/')}`,
        relPath,
        directory: innerDirectory
          ? `${directoryOfArchive}/${innerDirectory}`
          : directoryOfArchive,
        fileName,
        ext,
        kind: isArchive
          ? 'archive'
          : classifyFile(fileName, context.additionalExtensions),
        sizeBytes: entry.uncompressedSize,
        mtimeMs,
        materialize: () =>
          materializeChain(outerPath, entryChain, mtimeMs, context),
      };
      if (isArchive) {
        result.files.push(file);
        if (entry.uncompressedSize === 0) continue;
        if (depth + 1 > context.maxDepth) {
          result.problems.push({
            code: 'ZIP_DEPTH_EXCEEDED',
            relPath,
            detail: `ZIP の入れ子が深さ ${context.maxDepth} を超えるため、開きません`,
          });
          continue;
        }
        await visit(file, outerPath, entryChain, depth + 1);
        continue;
      }
      if (entry.uncompressedSize === 0) result.emptyFiles.push(file);
      else result.files.push(file);
    }
  };

  await visit(zipFile, zipFile.absolutePath, [], 1);
  return result;
};

/** 取り出せなかった原因を、問題にする */
export const problemFor = (error: unknown, relPath: string): ArchiveProblem => {
  if (error instanceof ZipExtractError && error.kind === 'encrypted')
    return { code: 'ZIP_ENCRYPTED', relPath, detail: error.message };
  return { code: 'READ_FAILED', relPath, detail: messageOf(error) };
};
