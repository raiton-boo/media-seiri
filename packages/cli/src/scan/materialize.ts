import type { Materialized, ScannedFile } from './scan.ts';

/**
 * ファイルを、読める場所に出す。通常のファイルは、そのまま(消さない)。ZIP の中のファイルは、一時領域に取り出す(`cleanup` で消す)。
 */
export const materializeFile = async (
  file: ScannedFile
): Promise<Materialized> =>
  file.materialize
    ? file.materialize()
    : { path: file.absolutePath, cleanup: async () => {} };

/** ファイルを、読める場所に出して、`use` に渡し、必ず、後始末をする */
export const withMaterialized = async <T>(
  file: ScannedFile,
  use: (path: string) => Promise<T>
): Promise<T> => {
  const materialized = await materializeFile(file);
  try {
    return await use(materialized.path);
  } finally {
    await materialized.cleanup();
  }
};
