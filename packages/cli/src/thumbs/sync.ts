import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { SNAPSHOT_DIRECTORY } from '@file-seiri/ledger';

/** ライブラリの中の、サムネイルの置き場(`<ライブラリの根>/.file-seiri/thumbs/`。仕様書 §16-2) */
export const libraryThumbsDir = (libraryRoot: string): string =>
  join(libraryRoot, SNAPSHOT_DIRECTORY, 'thumbs');

export type ThumbnailSyncResult = {
  copied: number;
  /** コピーできなかったもの(理由つき) */
  failed: string[];
  stopped: boolean;
};

/**
 * 正本(`data/` の `thumbs/`)から、ライブラリの `.file-seiri/thumbs/` へ、ないものだけをコピーする(差分)。
 * 同じ名前で大きさが同じものは、同じ内容のため、飛ばす(名前が内容のハッシュのため)。
 * 一時ファイル(`.` で始まる)は、コピーしない。コピーは、一時の名前に書いてから、正式な名前にする。
 */
export const copyThumbnailsToLibrary = (input: {
  thumbsDir: string;
  libraryRoot: string;
  shouldStop: () => boolean;
}): ThumbnailSyncResult => {
  const result: ThumbnailSyncResult = { copied: 0, failed: [], stopped: false };
  if (!existsSync(input.thumbsDir)) return result;
  const destinationRoot = libraryThumbsDir(input.libraryRoot);
  for (const folder of readdirSync(input.thumbsDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const file of readdirSync(join(input.thumbsDir, folder.name), {
      withFileTypes: true,
    })) {
      if (!file.isFile() || file.name.startsWith('.')) continue;
      if (input.shouldStop()) {
        result.stopped = true;
        return result;
      }
      const source = join(input.thumbsDir, folder.name, file.name);
      const destination = join(destinationRoot, folder.name, file.name);
      const temporary = `${destination}.part`;
      try {
        if (
          existsSync(destination) &&
          statSync(destination).size === statSync(source).size
        )
          continue;
        mkdirSync(join(destinationRoot, folder.name), { recursive: true });
        copyFileSync(source, temporary);
        renameSync(temporary, destination);
        result.copied += 1;
      } catch (error) {
        rmSync(temporary, { force: true });
        result.failed.push(
          `${folder.name}/${file.name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return result;
};
