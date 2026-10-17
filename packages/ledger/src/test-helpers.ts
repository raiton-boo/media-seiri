import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IN_MEMORY, type Ledger, openLedger } from './ledger.ts';

export const TEST_LIBRARY_ID = 'lib-test';

/** メモリ上の台帳。本物の `data/` には触れない */
export const openMemoryLedger = (): Ledger =>
  openLedger(IN_MEMORY, { libraryId: TEST_LIBRARY_ID });

/** 一時ディレクトリを作り、後始末の関数と一緒に返す */
export const makeTempDir = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-ledger-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

export const HASH_A = 'a'.repeat(64);
export const HASH_B = 'b'.repeat(64);
