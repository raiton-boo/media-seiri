import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLedger } from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { ledgerPathFor, libraryWorkDir } from '../config/paths.ts';
import { unregisterLibraries } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import {
  listRegisteredLibraries,
  type RegisteredLibrary,
} from '../library/choose.ts';
import { isEmptyLibrary, removeEmptyLibrary } from '../library/remove.ts';

const MIN_ID_LENGTH = 4;

/** この Mac の台帳に記録された、ライブラリのファイルの数(台帳がなければ 0) */
const countRecordedFiles = (
  context: CommandContext,
  libraryId: string
): number => {
  const path = ledgerPathFor(context.dataDir, libraryId);
  if (!existsSync(path)) return 0;
  const ledger = openLedger(path, { mode: 'readonly', libraryId });
  try {
    return (
      ledger.db
        .query<{ n: number }, []>('SELECT count(*) AS n FROM library_files')
        .get()?.n ?? 0
    );
  } finally {
    ledger.close();
  }
};

/** ID(先頭の 4 文字以上)または場所から、登録を探す。同じ場所の登録は、すべて */
const findRegistered = (
  context: CommandContext,
  target: string
): RegisteredLibrary[] => {
  const all = listRegisteredLibraries(context);
  const path = resolve(target);
  const byPath = all.filter((library) => library.root === path);
  if (byPath.length > 0) return byPath;
  if (target.length >= MIN_ID_LENGTH) {
    const byId = all.filter((library) => library.id.startsWith(target));
    if (byId.length > 1) {
      throw new CliError(
        `ID が、複数に一致します。もう少し長く指定してください:\n${byId.map((l) => `  ${l.id.slice(0, 12)}  ${l.root}`).join('\n')}`
      );
    }
    return byId;
  }
  return [];
};

/** `library forget <ID または場所>`: 設定から外すだけ(ファイル・目印・この Mac の台帳は、そのまま) */
export const libraryForget = (
  context: CommandContext,
  target: string | undefined
): ExitCode => {
  if (!target) {
    throw new CliError(
      '使い方: seiri library forget <ID または場所>(一覧は、seiri library list)'
    );
  }
  const found = findRegistered(context, target);
  if (found.length === 0) {
    throw new CliError(
      `登録されたライブラリが、見つかりません: ${target}(一覧は、seiri library list)`
    );
  }
  const removed = unregisterLibraries(
    context.dataDir,
    found.map((library) => library.id)
  );
  for (const library of found) {
    context.stdout(
      `設定から外しました: ${library.id.slice(0, 8)}  ${library.root}`
    );
  }
  context.stdout(
    `(ファイルと、この Mac の台帳は、そのままです。${removed.length} 件)`
  );
  return EXIT_CODES.ok;
};

/**
 * `library remove <ID または場所> [-y]`: **空の**ライブラリ(間違えて作った目印)を、片づける。
 * 目印・管理用のフォルダ・(seiri が置いた)ビューアを消し、設定から外し、この Mac の(空の)台帳を消す。
 * 写真が 1 枚でも入っていれば、何も消さずに、断る(設定から外すだけなら、`library forget`)。
 */
export const libraryRemove = async (
  context: CommandContext,
  target: string | undefined,
  yes: boolean
): Promise<ExitCode> => {
  if (!target) {
    throw new CliError(
      '使い方: seiri library remove <ID または場所> [-y](空のライブラリだけ)'
    );
  }
  const registered = findRegistered(context, target);
  const root = registered[0]?.root ?? resolve(target);
  if (!isEmptyLibrary(root)) {
    throw new CliError(
      `空のライブラリではないため、消しません: ${root}\n` +
        '(写真などが入っているか、ライブラリではありません。設定から外すだけなら、seiri library forget <ID>)'
    );
  }
  // この Mac の台帳に、記録(取り込んだ写真の履歴)が残っているなら、消さない(ドライブの中身だけが、なくなった場合など)
  for (const library of registered) {
    const recorded = countRecordedFiles(context, library.id);
    if (recorded > 0) {
      throw new CliError(
        `この Mac の台帳に、${recorded} 件の記録が残っているため、消しません: ${root}\n` +
          '(ドライブの中身だけが、なくなっている可能性があります。設定から外すだけなら、seiri library forget <ID>)'
      );
    }
  }
  context.stdout(`片づけるライブラリ(中身は、ありません): ${root}`);
  context.stdout(
    '  消すもの: ライブラリの目印・管理用のフォルダ(.file-seiri)・設定の登録・この Mac の空の台帳'
  );
  if (!yes) {
    if (!context.isInteractive) {
      context.stdout(
        '実行するには、--yes を付けて、もう一度実行してください。'
      );
      return EXIT_CODES.failed;
    }
    if (!(await context.confirm('片づけますか'))) {
      context.stdout('片づけませんでした。');
      return EXIT_CODES.ok;
    }
  }
  const result = removeEmptyLibrary(root);
  if (!result) {
    throw new CliError(`空ではなくなったため、消しませんでした: ${root}`);
  }
  for (const library of registered) {
    rmSync(libraryWorkDir(context.dataDir, library.id), {
      recursive: true,
      force: true,
    });
  }
  unregisterLibraries(
    context.dataDir,
    registered.map((library) => library.id)
  );
  context.stdout(
    `片づけました(消したもの ${result.removed.length} 件、残したもの ${result.skipped.length} 件)`
  );
  for (const path of result.skipped) context.stdout(`  残した: ${path}`);
  return EXIT_CODES.ok;
};
