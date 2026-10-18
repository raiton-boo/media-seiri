import type { LedgerError } from '@file-seiri/ledger';

/**
 * 台帳を開けなかったときの、利用者向けの説明。台帳が古い版(`SCHEMA_NEEDS_MIGRATION`)のときは、直し方を添える
 * (読み取り専用で開くコマンドは、台帳を移行できない。書き込みで開くコマンドが、移行する)。
 */
export const describeLedgerOpenError = (error: LedgerError): string =>
  error.code === 'SCHEMA_NEEDS_MIGRATION'
    ? `${error.message}\nプログラムを更新したあとは、書き込みで台帳を開くコマンド(verify・thumbs・ingest のどれか)を、一度実行すると、台帳が新しくなります。`
    : error.message;
