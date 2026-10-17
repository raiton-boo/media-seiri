import type { LogLine, Snapshot } from '../simulate.ts';

/** 3 つの見た目が、共通で受け取る情報 */
export type ViewProps = {
  snapshot: Snapshot;
  /** 最新のログ(新しいものが下) */
  logs: LogLine[];
  /** WARN と ERROR だけの、最新のログ */
  alerts: LogLine[];
  /** 一定間隔で測った、1 秒あたりのファイル数の履歴 */
  history: number[];
  elapsed: number;
  remaining: number;
  isStopping: boolean;
  columns: number;
  /** 端末の行数。足りないときは、パネルを減らす */
  rows: number;
  /** このプロセスの実測値 */
  system: SystemStats;
  /** 一時停止中か */
  isPaused: boolean;
  /** ログの全画面表示か */
  logView: boolean;
  /** 全画面のログ表示で使う、多めのログ */
  logsAll: LogLine[];
  /** スリープの抑止(caffeinate)が効いているか */
  sleepGuard: boolean;
  /** キー操作の結果などの、一時的なお知らせ(なければ空) */
  notice: string;
};

export type SystemStats = { cpuPercent: number; memoryMegabytes: number };

export type StyleName =
  | 'neo'
  | 'dashboard'
  | 'minimal'
  | 'cyber'
  | 'cipher'
  | 'synth'
  | 'btop'
  | 'retro';
