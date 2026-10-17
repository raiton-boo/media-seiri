import type { Bucket } from '@file-seiri/core';

/** コピーを始める前に、台帳に残すイベント(書き込みの先行記録)。コード */
export const COPY_START = 'COPY_START';

/**
 * コピーの意図。コピーの前に記録しておき、コピーの途中や、コピーのあと台帳に記録する前に、
 * 異常終了したとき、次の起動で、保存先にできたファイルを、見つけて採用するために使う(`recover.ts`)。
 * ファイルが先で、台帳が後(保存先に、実在しないファイルを、台帳に載せないため)。
 */
export type CopyIntent = {
  /** ソースの、ボリューム内の相対パス */
  src: string;
  /** ライブラリの根からの、保存先のパス */
  dest: string;
  hash: string;
  sizeBytes: number;
  stem: string;
  bucket: Bucket;
};

export const encodeCopyIntent = (intent: CopyIntent): string =>
  JSON.stringify(intent);

/** イベントのメッセージから、コピーの意図を読む。形が違えば undefined */
export const parseCopyIntent = (message: string): CopyIntent | undefined => {
  try {
    const raw: unknown = JSON.parse(message);
    if (typeof raw !== 'object' || raw === null) return undefined;
    const { src, dest, hash, sizeBytes, stem, bucket } = raw as Record<
      string,
      unknown
    >;
    if (
      typeof src !== 'string' ||
      typeof dest !== 'string' ||
      typeof hash !== 'string' ||
      typeof sizeBytes !== 'number' ||
      typeof stem !== 'string' ||
      typeof bucket !== 'string'
    ) {
      return undefined;
    }
    return { src, dest, hash, sizeBytes, stem, bucket: bucket as Bucket };
  } catch {
    return undefined;
  }
};
