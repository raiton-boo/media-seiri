import { ExifTool, type ExifToolOptions } from 'exiftool-vendored';
import { ensureExiftool, hasEmbeddedExiftool } from './embedded/registry.ts';

/**
 * ExifTool を作る。単一の実行ファイルのときは、埋め込んだ ExifTool を、初回にキャッシュへ展開して使う
 * (`node_modules` が、ないため)。開発のときは、`exiftool-vendored` が持つものを使う。
 */
export const createExifTool = (options: Partial<ExifToolOptions> = {}) =>
  new ExifTool({
    ...options,
    ...(hasEmbeddedExiftool() ? { exiftoolPath: () => ensureExiftool() } : {}),
  });
