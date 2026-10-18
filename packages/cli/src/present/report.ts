/** 画面に出す「結果」の、形。コマンドが作り、`ReportView` が、色つきの枠にして出す */

/** 値の色の意味 */
export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'dim';

export type Row = {
  label: string;
  value: string;
  tone?: Tone;
  /** 0〜1。あれば、値の左に、棒グラフを出す */
  ratio?: number;
};

export type Section = {
  title: string;
  tone?: Tone;
  rows?: Row[];
  /** そのまま出す行(一覧・問題の説明など) */
  lines?: string[];
  /** 表 */
  table?: { header: string[]; rows: string[][] };
};

export type Report = {
  title: string;
  /** 見出しの横の札(例: dry-run・完了) */
  badge?: { label: string; tone: Tone };
  sections: Section[];
  /** 最後の、ひと言(次にやること) */
  hint?: string;
};
