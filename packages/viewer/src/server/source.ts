import type { Ledger } from '@file-seiri/ledger';
import type { DiskUsage, LedgerSource, LibraryInfo } from '../api-types.ts';

/**
 * ビューアが読むもの(台帳・サムネイル・ライブラリ)。呼び出し側(`file-seiri viewer`・単体の実行ファイル)が決める。
 * ビューアは、どれも読むだけ(書き込まない)。
 */
export type ViewerSource = {
  library: LibraryInfo;
  source: LedgerSource;
  /** 読み取り専用で開いた台帳 */
  ledger: Ledger;
  /** ライブラリの根(原本の場所。ドライブが接続されていなければ、存在しない) */
  libraryRoot: string;
  /** サムネイルの置き場(`<ID>/` の下の `thumbs/`、または、ライブラリの `.file-seiri/thumbs/`) */
  thumbsDir: string;
  /** 台帳の鮮度 */
  asOf: () => Date;
  /** ライブラリのドライブの容量(接続されていなければ、null) */
  disk: () => DiskUsage | null;
  /**
   * いま接続されているドライブの、根の場所(ドライブの固有 ID → 根)。ソース側のコピーから原本を探すのに使う。
   * 省くと、ソース側は探さない。呼び出しのたびに、最新を返してよい(呼び出し側で、短く覚えておく)。
   */
  mountedRoots?: () => ReadonlyMap<string, string>;
  /** 現在の時刻(テストで差し替える) */
  now: () => Date;
};
