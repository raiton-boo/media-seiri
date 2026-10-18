import type { CommandContext } from '../context.ts';

/** `seiri` だけを打ったときの、入口のメニュー。選んだコマンドの引数を返す(やめたら undefined) */
export const mainMenu = async (
  context: CommandContext
): Promise<string[] | undefined> => {
  context.stdout('seiri — 写真・動画を、撮影日ごとに整理するツール');
  return context.ask.select<string[] | undefined>('何をしますか?', [
    {
      label: '写真を取り込む',
      hint: '(取り込み元と保存先を、選びます)',
      value: ['ingest'],
    },
    { label: '取り込んだ写真を、ブラウザで見る', value: ['viewer'] },
    { label: '今の状況を見る', value: ['status'] },
    { label: '接続中のドライブを見る', value: ['drives'] },
    { label: '使い方(ヘルプ)を見る', value: ['--help'] },
    { label: 'やめる', value: undefined },
  ]);
};
