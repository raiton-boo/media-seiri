import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { listRegisteredLibraries } from '../library/choose.ts';
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
    library.connected ? '接続中' : 'ドライブ未接続',
    library.root,
  ]);
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
      hint: '使うライブラリは、--library <場所> で指定します(接続中が 1 つだけなら、省けます)',
    });
    return EXIT_CODES.ok;
  }
  for (const line of formatTable(['ID', '状態', '場所'], rows))
    context.stdout(line);
  return EXIT_CODES.ok;
};
