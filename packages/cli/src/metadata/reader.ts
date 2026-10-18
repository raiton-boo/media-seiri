import type { Tags } from 'exiftool-vendored';
import { createExifTool } from '../exiftool.ts';
import { type ExtractedMetadata, extractMetadata } from './tags.ts';

export type MetadataReadResult =
  | { ok: true; metadata: ExtractedMetadata }
  // 読めなかった(ファイルがない・ExifTool の失敗・タグに Error がある)。記録は、呼び出し側(READ_FAILED)
  | { ok: false; error: string };

export type MetadataReader = {
  /** `isVideo`: 動画なら true(日付の読み方が違う) */
  read(path: string, isVideo: boolean): Promise<MetadataReadResult>;
  /** 常駐の ExifTool を終える。使い終わったら、必ず呼ぶ */
  close(): Promise<void>;
};

export type MetadataReaderOptions = {
  /** 同時に動かす ExifTool の数。既定は、ExifTool 側の既定(CPU の数に応じる) */
  maxProcs?: number;
  /** 1 ファイルあたりの上限(ミリ秒) */
  taskTimeoutMillis?: number;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * ExifTool(常駐)で、メタデータを読む。例外にはせず、結果で返す。
 * 同時に複数の `read` を呼んでよい(`maxProcs` までが、並行して動く)。
 */
export const createMetadataReader = (
  options: MetadataReaderOptions = {}
): MetadataReader => {
  const exiftool = createExifTool({
    ...(options.maxProcs === undefined ? {} : { maxProcs: options.maxProcs }),
    ...(options.taskTimeoutMillis === undefined
      ? {}
      : { taskTimeoutMillis: options.taskTimeoutMillis }),
  });
  return {
    read: async (path, isVideo) => {
      let tags: Tags;
      try {
        tags = await exiftool.read(path);
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
      const failure = typeof tags.Error === 'string' ? tags.Error : undefined;
      if (failure) return { ok: false, error: failure };
      return { ok: true, metadata: extractMetadata(tags, isVideo) };
    },
    close: async () => {
      await exiftool.end();
    },
  };
};
