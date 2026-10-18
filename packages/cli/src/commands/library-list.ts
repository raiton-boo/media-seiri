import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { listRegisteredLibraries, STATE_LABELS } from '../library/choose.ts';
import { showReport } from '../present/index.ts';
import { formatTable } from '../table.ts';

const SHORT_ID_LENGTH = 8;

/** `library list`: この Mac に登録されたライブラリの一覧(ドライブが接続中かも) */
export const libraryList = (context: CommandContext): ExitCode => {
  const libraries = listRegisteredLibraries(context);
  if (libraries.length === 0) {
    context.stdout(
      'この Mac に登録されたライブラリは、ありません(作るときは、seiri library init <保存先>)。'
    );
    return EXIT_CODES.ok;
  }
  const rows = libraries.map((library) => [
    library.id.slice(0, SHORT_ID_LENGTH),
    STATE_LABELS[library.state],
    library.root,
  ]);
  const stale = libraries.filter((library) => library.state === 'stale').length;
  if (context.fancy) {
    showReport(context, {
      title: 'ライブラリ',
      badge: { label: `${libraries.length} 件`, tone: 'info' },
      sections: [
        {
          title: '登録済み',
          tone: 'info',
          table: { header: ['ID', '状態', '場所'], rows },
        },
      ],
      hint:
        stale > 0
          ? `古い登録が ${stale} 件あります。seiri library prune で、外せます(ファイルは、消しません)`
          : '使うライブラリは、--library <場所> で指定します(接続中が 1 つだけなら、省けます)',
    });
    return EXIT_CODES.ok;
  }
  for (const line of formatTable(['ID', '状態', '場所'], rows))
    context.stdout(line);
  if (stale > 0) {
    context.stdout(
      `\n古い登録が ${stale} 件あります(同じ場所に、作り直したライブラリがあります)。seiri library prune で、外せます(ファイルは、消しません)。`
    );
  }
  return EXIT_CODES.ok;
};
