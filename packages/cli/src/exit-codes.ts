/** 終了コード(`docs/features/cli-logging.md` §9) */
export const EXIT_CODES = {
  /** 正常終了(エラーなし) */
  ok: 0,
  /** 完了したが、エラーのファイルがあった */
  completedWithErrors: 1,
  /** 実行できなかった(保存先の検査・容量不足・使い方の誤りなど) */
  failed: 2,
  /** 中断(Ctrl-C) */
  interrupted: 130,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
