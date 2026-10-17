import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { LedgerError, type LedgerErrorCode } from './errors.ts';
import { openLedger } from './ledger.ts';
import { getLibraryId, getRevision, getSchemaVersion } from './meta.ts';
import { getUserVersion } from './migrate.ts';
import { LATEST_SCHEMA_VERSION } from './migrations/index.ts';
import {
  makeTempDir,
  openMemoryLedger,
  TEST_LIBRARY_ID,
} from './test-helpers.ts';

const cleanups: Array<() => void> = [];
const newTemp = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const expectLedgerError = (
  work: () => unknown,
  code: LedgerErrorCode
): void => {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError);
    expect((error as LedgerError).code).toBe(code);
    return;
  }
  throw new Error(`LedgerError(${code}) が投げられなかった`);
};

describe('openLedger(書き込み用)', () => {
  test('新しい台帳に、最新のスキーマ・ライブラリ ID・リビジョン 0 が入る', () => {
    const ledger = openMemoryLedger();
    expect(getUserVersion(ledger.db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(ledger.db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getLibraryId(ledger.db)).toBe(TEST_LIBRARY_ID);
    expect(getRevision(ledger.db)).toBe(0);
    expect(ledger.libraryId).toBe(TEST_LIBRARY_ID);
    expect(ledger.mode).toBe('readwrite');
    ledger.close();
  });

  test('外部キーが、強制される', () => {
    const ledger = openMemoryLedger();
    const row = ledger.db.query('PRAGMA foreign_keys').get() as {
      foreign_keys: number;
    };
    expect(row.foreign_keys).toBe(1);
    ledger.close();
  });

  test('ファイルの台帳は、ディレクトリも作り、WAL で開く', () => {
    const path = join(newTemp(), 'libraries', 'abc', 'catalog.sqlite');
    const ledger = openLedger(path, { libraryId: 'abc' });
    const row = ledger.db.query('PRAGMA journal_mode').get() as {
      journal_mode: string;
    };
    expect(row.journal_mode).toBe('wal');
    ledger.close();
  });

  test('開き直しても、同じ台帳(移行は、もう一度適用されない)', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    const first = openLedger(path, { libraryId: 'abc' });
    first.db.query("UPDATE meta SET value = '7' WHERE key = 'revision'").run();
    first.close();

    const second = openLedger(path);
    expect(getRevision(second.db)).toBe(7);
    expect(second.libraryId).toBe('abc');
    second.close();
  });

  test('新しい台帳に libraryId がないときは、エラー', () => {
    expectLedgerError(
      () => openLedger(join(newTemp(), 'catalog.sqlite')),
      'LIBRARY_ID_REQUIRED'
    );
  });

  test('別のライブラリ ID を指定すると、エラー(取り違えを防ぐ)', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();
    expectLedgerError(
      () => openLedger(path, { libraryId: 'other' }),
      'LIBRARY_ID_MISMATCH'
    );
  });

  test('transaction: 途中で失敗したら、すべて取り消す', () => {
    const ledger = openMemoryLedger();
    expect(() =>
      ledger.transaction(() => {
        ledger.db
          .query(
            "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES ('u1', '2026-10-18T00:00:00Z')"
          )
          .run();
        throw new Error('途中で失敗');
      })
    ).toThrow('途中で失敗');
    const count = ledger.db
      .query('SELECT count(*) AS n FROM volumes')
      .get() as {
      n: number;
    };
    expect(count.n).toBe(0);
    ledger.close();
  });

  test('transaction: 戻り値を返し、入れ子にもできる', () => {
    const ledger = openMemoryLedger();
    const value = ledger.transaction(() => ledger.transaction(() => 42));
    expect(value).toBe(42);
    ledger.close();
  });
});

describe('openLedger(読み取り専用)', () => {
  test('読めるが、書けない', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();

    const ledger = openLedger(path, { mode: 'readonly' });
    expect(ledger.mode).toBe('readonly');
    expect(ledger.libraryId).toBe('abc');
    expect(getRevision(ledger.db)).toBe(0);
    expect(() =>
      ledger.db
        .query("UPDATE meta SET value = '1' WHERE key = 'revision'")
        .run()
    ).toThrow();
    ledger.close();
  });

  test('書き込み用の接続が開いたままでも、読める(WAL)', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    const writer = openLedger(path, { libraryId: 'abc' });
    const reader = openLedger(path, { mode: 'readonly' });
    writer.db.query("UPDATE meta SET value = '3' WHERE key = 'revision'").run();
    expect(getRevision(reader.db)).toBe(3);
    reader.close();
    writer.close();
  });

  test('ファイルがなければ、エラー(作らない)', () => {
    expect(() =>
      openLedger(join(newTemp(), 'none.sqlite'), { mode: 'readonly' })
    ).toThrow();
  });

  test('スキーマが古い台帳は、移行せずに、エラー', () => {
    const path = join(newTemp(), 'old.sqlite');
    new Database(path, { create: true }).close();
    expectLedgerError(
      () => openLedger(path, { mode: 'readonly' }),
      'SCHEMA_NEEDS_MIGRATION'
    );
  });

  test('スキーマが新しい台帳は、エラー', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();
    const db = new Database(path);
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    db.close();
    expectLedgerError(
      () => openLedger(path, { mode: 'readonly' }),
      'SCHEMA_TOO_NEW'
    );
    expectLedgerError(() => openLedger(path), 'SCHEMA_TOO_NEW');
  });

  test('user_version と meta の版が食い違う台帳は、エラー', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();
    const db = new Database(path);
    db.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expectLedgerError(
      () => openLedger(path, { mode: 'readonly' }),
      'SCHEMA_INCONSISTENT'
    );
  });

  test('ライブラリ ID を指定して、違うときは、エラー', () => {
    const path = join(newTemp(), 'catalog.sqlite');
    openLedger(path, { libraryId: 'abc' }).close();
    expectLedgerError(
      () => openLedger(path, { mode: 'readonly', libraryId: 'other' }),
      'LIBRARY_ID_MISMATCH'
    );
  });
});
