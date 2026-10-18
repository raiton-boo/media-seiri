import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { classifyFile } from '@file-seiri/core';
import { listThumbnailCandidates, setThumbRelPath } from '@file-seiri/ledger';
import { mapConcurrent } from '../ingest/concurrency.ts';
import type { WriteTransaction } from '../ingest/transaction.ts';
import type { ThumbnailKind, ThumbnailMaker } from './maker.ts';

export type ThumbnailStageInput = {
  db: Database;
  write: WriteTransaction;
  libraryRoot: string;
  /** 正本の置き場(`data/libraries/<ID>/thumbs/`) */
  thumbsDir: string;
  maker: ThumbnailMaker;
  /** 保存先のドライブを読む、同時の数(`readConcurrency`) */
  concurrency: number;
  shouldStop: () => boolean;
  /** 作れなかったとき(WARN の記録は、呼び出し側) */
  onFailure: (relPath: string, message: string) => void;
  onProgress?: (done: number, total: number) => void;
};

export type ThumbnailStageResult = {
  /** 新しく作った数 */
  made: number;
  /** すでにある(同じ内容のものを含む)ので、記録だけした数 */
  reused: number;
  /** 作れなかった数 */
  failed: number;
  /** すでに作ってあり、何もしなかった数 */
  present: number;
  /** サムネイルの対象でない(写真・動画・RAW 以外。XMP など)ので、数えなかった数 */
  notMedia: number;
  stopped: boolean;
};

/** サムネイルの場所(`thumbs/` からの相対パス)。内容のハッシュから決める(同じ内容は、1 つで足りる) */
export const thumbRelPathOf = (contentHash: string): string =>
  `${contentHash.slice(0, 2)}/${contentHash}.jpg`;

const THUMBNAIL_KINDS: ReadonlySet<string> = new Set(['photo', 'raw', 'video']);

/**
 * サムネイルがない(記録がない、または、ファイルが消えた)ライブラリのファイルに、サムネイルを作る。
 * 何度でも実行できる(あるものは、飛ばす)。途中で止まっても、次の実行が、残りから続ける。
 * 作れなかったファイルは、取り込みの失敗にはしない(`onFailure` で伝え、記録は空のまま。次の実行で、また試す)。
 * 作ったものは、一時ファイルに書いて、できてから正式な名前にする(途中のものを、残さない)。
 */
export const makeThumbnails = async (
  input: ThumbnailStageInput
): Promise<ThumbnailStageResult> => {
  const result: ThumbnailStageResult = {
    made: 0,
    reused: 0,
    failed: 0,
    present: 0,
    notMedia: 0,
    stopped: false,
  };
  type Target = {
    libraryFileId: number;
    relPath: string;
    kind: ThumbnailKind;
    thumbRelPath: string;
  };
  const targets: Target[] = [];
  for (const candidate of listThumbnailCandidates(input.db)) {
    const kind = classifyFile(candidate.relPath);
    if (!THUMBNAIL_KINDS.has(kind)) {
      result.notMedia += 1;
      continue;
    }
    const thumbRelPath = thumbRelPathOf(candidate.contentHash);
    if (
      candidate.thumbRelPath === thumbRelPath &&
      existsSync(join(input.thumbsDir, thumbRelPath))
    ) {
      result.present += 1;
      continue;
    }
    targets.push({
      libraryFileId: candidate.libraryFileId,
      relPath: candidate.relPath,
      kind: kind as ThumbnailKind,
      thumbRelPath,
    });
  }

  let done = 0;
  await mapConcurrent(targets, input.concurrency, async (target) => {
    if (result.stopped || input.shouldStop()) {
      result.stopped = true;
      return;
    }
    const thumbPath = join(input.thumbsDir, target.thumbRelPath);
    if (existsSync(thumbPath)) {
      // 同じ内容の別のファイルが、先に作った
      result.reused += 1;
    } else {
      const sourcePath = join(input.libraryRoot, target.relPath);
      const temporaryPath = join(
        dirname(thumbPath),
        `.${target.libraryFileId}.tmp.jpg`
      );
      try {
        if (!existsSync(sourcePath)) throw new Error('ファイルがありません');
        mkdirSync(dirname(thumbPath), { recursive: true });
        await input.maker.make({
          kind: target.kind,
          sourcePath,
          outputPath: temporaryPath,
        });
        if (!existsSync(temporaryPath) || statSync(temporaryPath).size === 0) {
          throw new Error('空の画像ができました');
        }
        renameSync(temporaryPath, thumbPath);
        result.made += 1;
      } catch (error) {
        rmSync(temporaryPath, { force: true });
        result.failed += 1;
        input.onFailure(
          target.relPath,
          error instanceof Error ? error.message : String(error)
        );
        return;
      } finally {
        done += 1;
        input.onProgress?.(done, targets.length);
      }
    }
    input.write(() =>
      setThumbRelPath(input.db, target.libraryFileId, target.thumbRelPath)
    );
  });
  return result;
};
