import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { markerExists } from '../library/marker.ts';

/** ライブラリを使うコマンド(ライブラリが複数あるときは、どれか、選んでもらう) */
const NEEDS_LIBRARY = new Set(['viewer', 'status']);

/** 登録済みで、いま使えるライブラリの根 */
const usableLibraries = (context: CommandContext): string[] =>
  Object.values(readConfig(context.dataDir).libraries)
    .map((entry) => entry.root)
    .filter((root) => markerExists(root));

/** `seiri` だけを打ったときの、入口のメニュー。選んだコマンドの引数を返す(やめたら undefined) */
export const mainMenu = async (
  context: CommandContext
): Promise<string[] | undefined> => {
  const chosen = await context.ask.select<string[] | undefined>(
    '何をしますか?',
    [
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
    ]
  );
  if (!chosen || !NEEDS_LIBRARY.has(chosen[0] ?? '')) return chosen;
  const libraries = usableLibraries(context);
  if (libraries.length <= 1) return chosen;
  const root = await context.ask.select(
    'どのライブラリにしますか?',
    libraries.map((library) => ({ label: library, value: library }))
  );
  return [...chosen, '--library', root];
};
