/** 診断の 1 件。`fix` があれば、`--fix` で、安全に直せる(設定の記録・一時ファイル・付属ファイルだけ。写真・台帳は、消さない) */
export type Finding = {
  /** ok: 問題なし / info: 知らせ / warn: 注意 / error: 問題 */
  level: 'ok' | 'info' | 'warn' | 'error';
  /** 区分(登録・ドライブ・台帳・外のコマンドなど) */
  area: string;
  title: string;
  detail?: string;
  /** 対処(コマンドの例など) */
  hint?: string;
  fix?: {
    label: string;
    /** 直して、結果の 1 行を返す */
    run: () => string;
  };
};
