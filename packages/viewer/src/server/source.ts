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
  /** サムネイルの置き場(`<ID>/` の下の `thumbs/`、または、ライブラリの `.file-seiri/thumbs/`) */
  thumbsDir: string;
  /** 台帳の鮮度 */
  asOf: () => Date;
  /** ライブラリのドライブの容量(接続されていなければ、null) */
  disk: () => DiskUsage | null;
  /** 現在の時刻(テストで差し替える) */
  now: () => Date;
};
