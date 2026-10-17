import { randomUUID } from 'node:crypto';
import type { VolumeInfo } from './volume/index.ts';

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
  /** パスが属するボリュームを調べる(テストでは、差し替える) */
  resolveVolume: (path: string) => VolumeInfo;
  /** 本機のタイムゾーン(IANA の名前)。動画の UTC を、この時刻に変換する */
  timeZone: string;
  /** 端末で動いていて、利用者に質問できるか */
  isInteractive: boolean;
  /** 「はい / いいえ」を質問する。`isInteractive` のときだけ呼ぶ */
  confirm: (question: string) => Promise<boolean>;
};

export const newLibraryId = (): string => randomUUID();
