import { randomUUID } from 'node:crypto';

/** コマンドが使う、外の世界との境目。テストでは、差し替える */
export type CommandContext = {
  /** 標準出力・標準エラーへの書き出し(改行は、呼び出し側が付ける) */
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** `data/`(作業用の台帳・ログ・一時領域)の場所 */
  dataDir: string;
  /** いまの時刻 */
  now: () => Date;
  /** 新しいライブラリ ID */
  newLibraryId: () => string;
};

export const newLibraryId = (): string => randomUUID();
