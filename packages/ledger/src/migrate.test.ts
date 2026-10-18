import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { LedgerError } from './errors.ts';
import { getSchemaVersion } from './meta.ts';
import { getUserVersion, migrate } from './migrate.ts';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations/index.ts';

describe('MIGRATIONS', () => {
  test('番号は、1 から、欠けずに並ぶ', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1)
    );
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });
});

describe('移行 0003(実行の種類)', () => {
  test('版 2 の台帳(実行の行がある)を移行すると、既存の実行は、取り込みになる', () => {
    const db = new Database(':memory:', { strict: true });
    migrate(db, MIGRATIONS.slice(0, 2));
    db.exec(
      "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES ('v', '2026-10-18T00:00:00Z')"
    );
    db.exec(
      "INSERT INTO runs (source_volume_id, started_at) VALUES (1, '2026-10-18T00:00:00Z')"
    );
    expect(migrate(db)).toBe(MIGRATIONS.length - 2);
    expect(db.query('SELECT kind FROM runs').all()).toEqual([
      { kind: 'ingest' },
    ]);
  });
});

describe('migrate', () => {
  test('空の DB に、すべて適用する', () => {
    const db = new Database(':memory:', { strict: true });
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  test('適用済みなら、何もしない', () => {
    const db = new Database(':memory:', { strict: true });
    migrate(db);
    expect(migrate(db)).toBe(0);
  });

  test('未適用の移行だけを、番号の順に適用する', () => {
    const db = new Database(':memory:', { strict: true });
    migrate(db);
    const next = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: 'add-note',
        sql: 'CREATE TABLE note (id INTEGER PRIMARY KEY) STRICT;',
      },
    ];
    expect(migrate(db, next)).toBe(1);
    expect(getUserVersion(db)).toBe(next.length);
    expect(getSchemaVersion(db)).toBe(next.length);
    expect(db.query('SELECT count(*) AS n FROM note').get()).toEqual({ n: 0 });
  });

  test('失敗した移行は、すべて取り消す(版も進まない)', () => {
    const db = new Database(':memory:', { strict: true });
    migrate(db);
    const broken = [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: 'broken',
        sql: 'CREATE TABLE half (id INTEGER PRIMARY KEY) STRICT; SELECT * FROM nothing;',
      },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(getUserVersion(db)).toBe(MIGRATIONS.length);
    expect(getSchemaVersion(db)).toBe(MIGRATIONS.length);
    expect(() => db.query('SELECT 1 FROM half').get()).toThrow();
  });

  test('台帳のほうが新しいときは、エラー', () => {
    const db = new Database(':memory:', { strict: true });
    migrate(db);
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(LedgerError);
  });

  test('番号が飛んでいる移行は、エラー', () => {
    const db = new Database(':memory:', { strict: true });
    expect(() =>
      migrate(db, [{ version: 2, name: 'skip', sql: 'SELECT 1;' }])
    ).toThrow('1 から順');
  });
});
