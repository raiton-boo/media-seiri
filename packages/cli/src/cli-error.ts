/** 利用者に、そのまま見せる失敗。メッセージだけを表示して、実行できなかった(終了コード 2)ことにする */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
