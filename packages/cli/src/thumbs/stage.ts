import { join } from 'node:path';
import type { MediaKind } from '@file-seiri/ledger';
import { libraryWorkDir } from '../config/paths.ts';
import type { CommandContext } from '../context.ts';
import { readConcurrency } from '../ingest/concurrency.ts';
import type { OpenedLibrary } from '../ingest/library.ts';
import type { WriteTransaction } from '../ingest/transaction.ts';
import { makeThumbnails, type ThumbnailStageResult } from './generate.ts';
import { copyThumbnailsToLibrary } from './sync.ts';

/** 進み具合を表示する間隔(件数) */
const PROGRESS_INTERVAL = 100;

export type ThumbnailReport = ThumbnailStageResult & {
  /** ライブラリの `.file-seiri/thumbs/` へコピーした数 */
  copied: number;
  copyFailed: number;
};

/** 正本の置き場: `data/libraries/<ID>/thumbs/` */
export const thumbsDirFor = (dataDir: string, libraryId: string): string =>
  join(libraryWorkDir(dataDir, libraryId), 'thumbs');

/**
 * サムネイルの段階: 足りないサムネイルを作り(正本は `data/`)、ライブラリの `.file-seiri/thumbs/` に、差分をコピーする。
 * 取り込みの最後と、`thumbs` コマンドで、同じ処理を使う。作れなかったものは、WARN(`THUMB_FAILED`)にして、続ける。
 */
export const runThumbnailStage = async (input: {
  context: CommandContext;
  library: OpenedLibrary;
  write: WriteTransaction;
  /** サムネイルの元を読む、ライブラリのドライブの種類(読み出しの並列数を決める) */
  mediaKind: MediaKind | undefined;
  /** 中断の要求(Ctrl-C・ロックを失った)が来ているか */
  stopRequested: () => boolean;
  log: (level: 'INFO' | 'WARN', code: string, message: string) => void;
}): Promise<ThumbnailReport> => {
  const { context, library, log } = input;
  const thumbsDir = thumbsDirFor(context.dataDir, library.libraryId);
  const maker = context.thumbnailMaker();
  let result: ThumbnailStageResult;
  try {
    result = await makeThumbnails({
      db: library.ledger.db,
      write: input.write,
      libraryRoot: library.root,
      thumbsDir,
      maker,
      concurrency: readConcurrency(input.mediaKind),
      shouldStop: input.stopRequested,
      onFailure: (relPath, message) =>
        log('WARN', 'THUMB_FAILED', `${relPath}: ${message}`),
      onProgress: (done, total) => {
        if (done % PROGRESS_INTERVAL === 0)
          context.stdout(`  サムネイル: ${done} / ${total}`);
      },
    });
  } finally {
    await maker.close();
  }

  // 作ったものを、ライブラリへコピーする(家の PC は、こちらを使う)。止まっていても、作った分は、コピーする
  const sync = copyThumbnailsToLibrary({
    thumbsDir,
    libraryRoot: library.root,
    shouldStop: () => false,
  });
  for (const failure of sync.failed) log('WARN', 'THUMB_COPY_FAILED', failure);

  const report: ThumbnailReport = {
    ...result,
    copied: sync.copied,
    copyFailed: sync.failed.length,
  };
  context.stdout(
    `サムネイル: 作成 ${report.made}・既存 ${report.present + report.reused}・失敗 ${report.failed}` +
      `(ライブラリへコピー: ${report.copied} 件${report.copyFailed > 0 ? `・失敗 ${report.copyFailed} 件` : ''})`
  );
  log(
    'INFO',
    'THUMB_RESULT',
    `サムネイル: 作成 ${report.made}・既存 ${report.present + report.reused}・失敗 ${report.failed}・コピー ${report.copied}${report.stopped ? '(中断)' : ''}`
  );
  return report;
};
