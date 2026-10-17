import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LedgerError } from './errors.ts';
import { getLibraryId, setLibraryId } from './meta.ts';
import { assertSchemaConsistent, getUserVersion, migrate } from './migrate.ts';
import { LATEST_SCHEMA_VERSION } from './migrations/index.ts';

/** メモリ上の台帳(テスト用)。ファイルは作らない */
export const IN_MEMORY = ':memory:';

// 別の接続が書き込み中でも、すぐに失敗せず、待つ時間(ミリ秒)。CLI の書き込みと Web の読み取りが重なるため
const BUSY_TIMEOUT_MS = 5000;

export type LedgerMode = 'readwrite' | 'readonly';

export type OpenLedgerOptions = {
  /** `readwrite`(既定)は、なければ作り、移行も適用する。`readonly` は、何も書かない */
  mode?: LedgerMode;
  /**
   * ライブラリ ID。新しい台帳を作るときは必須。
   * 既にある台帳に付いている ID と違うときは、エラー(別のライブラリの台帳を、取り違えないため)。
   */
  libraryId?: string;
};

export type Ledger = {
  readonly db: Database;
  readonly path: string;
  readonly mode: LedgerMode;
  readonly libraryId: string;
  /** 1 つのトランザクションで実行する(まとめてコミット。仕様書 §17-6)。入れ子にもできる */
  transaction<T>(work: () => T): T;
  close(): void;
};

const openReadWrite = (
  path: string,
  libraryId: string | undefined
): Database => {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  try {
    // WAL: CLI が書き込み中でも、Web が読める。外部キーは、接続ごとに指定しないと、強制されない
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    migrate(db);
    assertSchemaConsistent(db);
    const existing = getLibraryId(db);
    if (existing === undefined) {
      if (libraryId === undefined) {
        throw new LedgerError(
          'LIBRARY_ID_REQUIRED',
          '台帳にライブラリ ID がありません。libraryId を指定してください'
        );
      }
      setLibraryId(db, libraryId);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

const openReadOnly = (path: string): Database => {
  const db = new Database(path, { readonly: true, strict: true });
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = getUserVersion(db);
    if (version > LATEST_SCHEMA_VERSION) {
      throw new LedgerError(
        'SCHEMA_TOO_NEW',
        `台帳のスキーマ(${version})が、このプログラムが扱える版(${LATEST_SCHEMA_VERSION})より新しい。プログラムを更新してください`
      );
    }
    if (version < LATEST_SCHEMA_VERSION) {
      throw new LedgerError(
        'SCHEMA_NEEDS_MIGRATION',
        `台帳のスキーマ(${version})が古い(${LATEST_SCHEMA_VERSION} が必要)。読み取り専用では移行できません`
      );
    }
    assertSchemaConsistent(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

/** 台帳を開く。使い終わったら、`close()` で閉じる */
export const openLedger = (
  path: string,
  options: OpenLedgerOptions = {}
): Ledger => {
  const mode = options.mode ?? 'readwrite';
  const db =
    mode === 'readwrite'
      ? openReadWrite(path, options.libraryId)
      : openReadOnly(path);

  const libraryId = getLibraryId(db);
  if (
    libraryId === undefined ||
    (options.libraryId !== undefined && options.libraryId !== libraryId)
  ) {
    db.close();
    throw new LedgerError(
      'LIBRARY_ID_MISMATCH',
      `台帳のライブラリ ID(${libraryId ?? 'なし'})が、指定(${options.libraryId ?? 'なし'})と違います`
    );
  }

  return {
    db,
    path,
    mode,
    libraryId,
    transaction: (work) => db.transaction(work)(),
    close: () => db.close(),
  };
};
