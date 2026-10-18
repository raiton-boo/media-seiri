import { unregisterLibraries } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { listRegisteredLibraries } from '../library/choose.ts';

/**
 * `library prune`: 古い登録(同じ場所に、作り直したライブラリがある)を、設定から外す。
 * 外すのは、設定の記録だけ。ライブラリのファイルも、この Mac の台帳(`data/libraries/<ID>/`)も、消さない。
 */
export const libraryPrune = async (
  context: CommandContext,
  yes: boolean
): Promise<ExitCode> => {
  const stale = listRegisteredLibraries(context).filter(
    (library) => library.state === 'stale'
  );
  if (stale.length === 0) {
    context.stdout('古い登録は、ありません。');
    return EXIT_CODES.ok;
  }
  context.stdout(`古い登録が ${stale.length} 件あります:`);
  for (const library of stale) {
    context.stdout(`  ${library.id.slice(0, 8)}  ${library.root}`);
  }
  if (!yes) {
    if (!context.isInteractive) {
      context.stdout('外すには、--yes を付けて、もう一度実行してください。');
      return EXIT_CODES.failed;
    }
    if (
      !(await context.confirm(
        '設定から外しますか(ファイルと、この Mac の台帳は、消しません)'
      ))
    ) {
      context.stdout('外しませんでした。');
      return EXIT_CODES.ok;
    }
  }
  const removed = unregisterLibraries(
    context.dataDir,
    stale.map((library) => library.id)
  );
  context.stdout(
    `${removed.length} 件を、設定から外しました(この Mac の台帳は、data/libraries/ に残してあります)。`
  );
  return EXIT_CODES.ok;
};
