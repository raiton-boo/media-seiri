import { randomUUID } from 'node:crypto';
import type { Asker } from './ask.ts';
import type { IngestHooks } from './ingest/copy-stage.ts';
import type { LiveController } from './live/controller.ts';
import type { IngestProgress, PauseGate } from './live/progress.ts';
import type { RepairTools } from './repair/index.ts';
import type { ThumbnailMaker } from './thumbs/maker.ts';
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
  /** 結果を、色つきの枠(Ink)で出すか(端末で、`NO_COLOR` がないとき)。出さないときは、文字だけの行。テストでは、いつも false */
  fancy: boolean;
  /** ログの表示に、色を付けるか(端末で、`NO_COLOR` がないとき)。テストでは、差し替える */
  useColor: boolean;
  /** 指定のミリ秒、待つ(`logs --follow`)。テストでは、差し替える */
  sleep: (milliseconds: number) => Promise<void>;
  /** サムネイルを作るもの(sips・ffmpeg・ExifTool を使う)。使い終わったら、`close` を呼ぶ。テストでは、差し替える */
  thumbnailMaker: () => ThumbnailMaker;
  /** 選んでもらう・入力してもらう口(対話式)。`isInteractive` のときだけ呼ぶ。テストでは、決まった答えを返すものに、差し替える */
  ask: Asker;
  /** 取り込みの進み具合を、画面(ライブ表示)に伝える口。画面を使わないときは、何もしない */
  progress: IngestProgress;
  /** 一時停止の関門(ライブ表示の `p` キー)。処理の合間に `wait()` を呼ぶ。画面を使わないときは、いつも通る */
  pause: PauseGate;
  /** ライブ表示を作る(端末で、`--plain` でないときの取り込みが使う)。テストでは、画面を出さない偽物に、差し替える */
  liveController: () => LiveController;
  /** 取り込みの結果のまとめ(サマリー)を、出す。ライブ表示の間は、画面を閉じてから、まとめて出す。既定は、標準出力 */
  report?: (lines: readonly string[]) => void;
  /** 破損の検査と修復に使う道具(ffmpeg・sips・ExifTool)。使い終わったら、`close` を呼ぶ。テストでは、差し替える */
  repairTools: () => RepairTools;
  /** 閲覧専用ビューアの実行ファイル一式の場所(ドライブの `viewer/` へ置くもの)。なければ、置かない。テストでは、差し替える */
  viewerBundleDir: string | undefined;
  /** 画面(ビューア)の静的ファイルの場所。テストでは、差し替える */
  viewerWebDir: string;
  /** テストで、取り込みの途中に割り込むための差し込み口 */
  ingestHooks?: IngestHooks;
};

export const newLibraryId = (): string => randomUUID();
