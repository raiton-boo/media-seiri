import { randomUUID } from 'node:crypto';
import type { IngestHooks } from './ingest/copy-stage.ts';
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
  /** 接続中のドライブの一覧(`drives`)。テストでは、差し替える */
  listVolumes: () => VolumeInfo[];
  /** 本機のタイムゾーン(IANA の名前)。動画の UTC を、この時刻に変換する */
  timeZone: string;
  /** 端末で動いていて、利用者に質問できるか */
  isInteractive: boolean;
  /** 「はい / いいえ」を質問する。`isInteractive` のときだけ呼ぶ */
  confirm: (question: string) => Promise<boolean>;
  /** 中断の要求(Ctrl-C を 1 回)が、来ているか。取り込みは、今のファイルまで終えて、止まる */
  shouldStop: () => boolean;
  /** 0 以上 1 未満の乱数(`verify --sample` の抜き取り)。テストでは、差し替える */
  random: () => number;
  /** テストで、取り込みの途中に割り込むための差し込み口 */
  ingestHooks?: IngestHooks;
};

export const newLibraryId = (): string => randomUUID();
