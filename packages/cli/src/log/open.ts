import { existsSync } from 'node:fs';
import { type Ledger, LedgerError, openLedger } from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { ledgerPathFor } from '../config/paths.ts';
import type { CommandContext } from '../context.ts';
import { describeLedgerOpenError } from '../ledger-error.ts';
import { chooseLibraryRoot, libraryIdOf } from '../library/choose.ts';

export type ReadOnlyLibrary = {
  root: string;
  libraryId: string;
  ledger: Ledger;
};

/**
 * ライブラリの作業用の台帳を、読み取り専用で開く(`logs`・`status`)。何も書かない・ロックも取らない。
 * 取り込み中でも、開ける(WAL)。台帳は、この Mac にあるため、ライブラリのドライブが抜けていても、読める。
 */
export const openLibraryReadOnly = async (
  context: CommandContext,
  libraryOption: string | undefined
): Promise<ReadOnlyLibrary> => {
  const root = await chooseLibraryRoot(context, libraryOption);
  const libraryId = libraryIdOf(context, root);
  const path = ledgerPathFor(context.dataDir, libraryId);
  if (!existsSync(path)) {
    throw new CliError(
      `この Mac に、このライブラリの台帳がありません(まだ取り込んでいない、または、別の Mac の台帳です): ${root}`
    );
  }
  try {
    return {
      root,
      libraryId,
      ledger: openLedger(path, { mode: 'readonly', libraryId }),
    };
  } catch (error) {
    if (error instanceof LedgerError)
      throw new CliError(`台帳を開けません: ${describeLedgerOpenError(error)}`);
    throw error;
  }
};
