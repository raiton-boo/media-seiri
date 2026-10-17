import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedgerError } from './errors.ts';
import { openLedger } from './ledger.ts';
import { acquireLock, readLock } from './lock.ts';
import { getRevision, incrementRevision } from './meta.ts';
import {
  compareWithSnapshot,
  createSnapshot,
  restoreFromSnapshot,
  snapshotPathOf,
} from './snapshot.ts';
import { makeTempDir } from './test-helpers.ts';

const T0 = new Date('2026-10-18T00:00:00.000Z');
const LIBRARY_ID = 'abc';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const newDir = (): string => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  return dir;
};

const addVolume = (db: Database, uuid: string): void => {
  db.query(
    "INSERT INTO volumes (volume_uuid, last_seen_at) VALUES (?, '2026-10-18T00:00:00Z')"
  ).run(uuid);
};
const volumeCount = (db: Database): number =>
  (db.query('SELECT count(*) AS n FROM volumes').get() as { n: number }).n;
const journalModeOf = (path: string): string => {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query('PRAGMA journal_mode').get() as { journal_mode: string })
      .journal_mode;
  } finally {
    db.close();
  }
};
/** SQLite のヘッダーの、読み書きの版(18・19 バイト目)。1 が通常(WAL でない)、2 が WAL */
const headerVersions = (
  path: string
): [number | undefined, number | undefined] => {
  const bytes = readFileSync(path);
  return [bytes[18], bytes[19]];
};

describe('createSnapshot', () => {
  test('作業用の台帳(WAL)から、WAL ではない形式のスナップショットを作る', () => {
    const dir = newDir();
    const ledger = openLedger(join(dir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    expect(journalModeOf(join(dir, 'catalog.sqlite'))).toBe('wal');
    addVolume(ledger.db, 'v1');
    incrementRevision(ledger.db);

    const path = snapshotPathOf(join(dir, 'library'));
    expect(createSnapshot(ledger, path)).toEqual({ revision: 1 });
    expect(headerVersions(join(dir, 'catalog.sqlite'))).toEqual([2, 2]);
    expect(headerVersions(path)).toEqual([1, 1]);
    expect(journalModeOf(path)).toBe('delete');
    // 一時ファイルも、WAL の付属ファイルも、残らない
    expect(readdirSync(join(dir, 'library', '.file-seiri'))).toEqual([
      'catalog.snapshot.sqlite',
    ]);
    ledger.close();
  });

  test('まだ作業用の台帳のファイルに反映されていない書き込み(WAL の中)も、含む', () => {
    const dir = newDir();
    const ledger = openLedger(join(dir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    addVolume(ledger.db, 'v1');
    const path = join(dir, 'snap.sqlite');
    createSnapshot(ledger, path);
    const snapshot = openLedger(path, { mode: 'readonly' });
    expect(volumeCount(snapshot.db)).toBe(1);
    expect(snapshot.libraryId).toBe(LIBRARY_ID);
    expect(
      (
        snapshot.db.query('PRAGMA integrity_check').get() as {
          integrity_check: string;
        }
      ).integrity_check
    ).toBe('ok');
    snapshot.close();
    ledger.close();
  });

  test('ロックは、持ち込まない(作業用の台帳には、残る)', () => {
    const dir = newDir();
    const ledger = openLedger(join(dir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    acquireLock(ledger.db, { holder: 'one', now: T0 });
    const path = join(dir, 'snap.sqlite');
    createSnapshot(ledger, path);
    const snapshot = openLedger(path, { mode: 'readonly' });
    expect(readLock(snapshot.db, 'ingest')).toBeUndefined();
    expect(readLock(ledger.db, 'ingest')?.holder).toBe('one');
    snapshot.close();
    ledger.close();
  });

  test('読み取り専用のフォルダに置いても、開いて読める(WAL のファイルは、開けない)', () => {
    const dir = newDir();
    const ledger = openLedger(join(dir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    addVolume(ledger.db, 'v1');
    const snapshotPath = join(dir, 'ro', 'snap.sqlite');
    createSnapshot(ledger, snapshotPath);
    ledger.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    ledger.close();
    // 対照: WAL のファイルを、同じように置く
    const walDir = join(dir, 'ro-wal');
    const walCopy = openLedger(join(walDir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    walCopy.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    walCopy.close();

    const readonlyDirs = [join(dir, 'ro'), walDir];
    try {
      for (const readonlyDir of readonlyDirs) chmodSync(readonlyDir, 0o555);
      chmodSync(snapshotPath, 0o444);
      const snapshot = openLedger(snapshotPath, { mode: 'readonly' });
      expect(volumeCount(snapshot.db)).toBe(1);
      snapshot.close();
    } finally {
      for (const readonlyDir of readonlyDirs) chmodSync(readonlyDir, 0o755);
    }
  });

  test('作り直すと、前のスナップショットを置き換える。失敗したら、前のものが残る', () => {
    const dir = newDir();
    const ledger = openLedger(join(dir, 'catalog.sqlite'), {
      libraryId: LIBRARY_ID,
    });
    const path = join(dir, 'snap.sqlite');
    createSnapshot(ledger, path);
    incrementRevision(ledger.db);
    expect(createSnapshot(ledger, path).revision).toBe(1);
    expect(readRevision(path)).toBe(1);

    // トランザクションの中では、VACUUM INTO は動かない
    expect(() =>
      ledger.transaction(() => createSnapshot(ledger, path))
    ).toThrow();
    expect(readRevision(path)).toBe(1);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    ledger.close();
  });
});

const readRevision = (path: string): number => {
  const ledger = openLedger(path, { mode: 'readonly' });
  try {
    return getRevision(ledger.db);
  } finally {
    ledger.close();
  }
};

/** 作業用の台帳(リビジョン working)と、スナップショット(リビジョン snapshot)を作る */
const setupPair = (working: number, snapshot: number | undefined) => {
  const dir = newDir();
  const workingPath = join(dir, 'data', 'catalog.sqlite');
  const snapshotPath = join(
    dir,
    'library',
    '.file-seiri',
    'catalog.snapshot.sqlite'
  );
  const ledger = openLedger(workingPath, { libraryId: LIBRARY_ID });
  const bump = (to: number): void => {
    while (getRevision(ledger.db) < to) incrementRevision(ledger.db);
  };
  if (snapshot !== undefined) {
    bump(snapshot);
    createSnapshot(ledger, snapshotPath);
  }
  bump(working);
  return { dir, ledger, workingPath, snapshotPath };
};

describe('compareWithSnapshot(リビジョンの比較)', () => {
  test('スナップショットがなければ、no-snapshot', () => {
    const { ledger, workingPath, snapshotPath } = setupPair(1, undefined);
    expect(compareWithSnapshot({ workingPath, snapshotPath })).toEqual({
      kind: 'no-snapshot',
    });
    ledger.close();
  });

  test('同じ・作業用のほうが新しい・スナップショットのほうが新しい', () => {
    const same = setupPair(2, 2);
    expect(compareWithSnapshot(same)).toEqual({
      kind: 'in-sync',
      workingRevision: 2,
      snapshotRevision: 2,
    });
    same.ledger.close();

    const workingNewer = setupPair(3, 1);
    expect(compareWithSnapshot(workingNewer)).toEqual({
      kind: 'working-newer',
      workingRevision: 3,
      snapshotRevision: 1,
    });
    workingNewer.ledger.close();

    // スナップショットのほうが新しい: 作業用の台帳を、古い状態に戻す
    const { dir, ledger, snapshotPath } = setupPair(1, 4);
    const oldWorking = join(dir, 'old.sqlite');
    ledger.close();
    const old = openLedger(oldWorking, { libraryId: LIBRARY_ID });
    incrementRevision(old.db);
    old.close();
    expect(
      compareWithSnapshot({ workingPath: oldWorking, snapshotPath })
    ).toEqual({
      kind: 'snapshot-newer',
      workingRevision: 1,
      snapshotRevision: 4,
    });
  });

  test('作業用の台帳がなければ、working-missing(復元できる)', () => {
    const { ledger, dir, snapshotPath } = setupPair(2, 2);
    ledger.close();
    expect(
      compareWithSnapshot({
        workingPath: join(dir, 'none.sqlite'),
        snapshotPath,
      })
    ).toEqual({
      kind: 'working-missing',
      snapshotRevision: 2,
    });
  });

  test('何も書き換えない(比べるだけ)', () => {
    const pair = setupPair(1, 3);
    const before = readFileSync(pair.snapshotPath);
    compareWithSnapshot(pair);
    expect(readFileSync(pair.snapshotPath).equals(before)).toBe(true);
    pair.ledger.close();
  });

  test('別のライブラリのスナップショットは、エラー', () => {
    const pair = setupPair(1, 1);
    expect(() => compareWithSnapshot({ ...pair, libraryId: 'other' })).toThrow(
      LedgerError
    );
    pair.ledger.close();
  });
});

describe('restoreFromSnapshot', () => {
  test('作業用の台帳が、すでにあるときは、確認がなければ、置き換えない', () => {
    const pair = setupPair(1, 4);
    pair.ledger.close();
    const before = readFileSync(pair.workingPath);
    expect(() =>
      restoreFromSnapshot({ ...pair, confirmed: false, now: T0 })
    ).toThrow(LedgerError);
    expect(readFileSync(pair.workingPath).equals(before)).toBe(true);
  });

  test('確認があれば、置き換える。前の台帳(と WAL)は、消さずに、移す', () => {
    const pair = setupPair(1, 4);
    addVolume(pair.ledger.db, 'only-in-working'); // WAL の中にだけある書き込み
    const result = restoreFromSnapshot({ ...pair, confirmed: true, now: T0 });
    pair.ledger.close();
    expect(result.restoredRevision).toBe(4);
    expect(result.backupPath).toBe(
      `${pair.workingPath}.replaced-2026-10-18T00-00-00.000Z`
    );

    const restored = openLedger(pair.workingPath, { libraryId: LIBRARY_ID });
    expect(getRevision(restored.db)).toBe(4);
    expect(volumeCount(restored.db)).toBe(0);
    expect(journalModeOf(pair.workingPath)).toBe('wal'); // 書き込み用に開き直すと、WAL に戻る
    restored.close();

    const backup = new Database(result.backupPath ?? '', { readonly: true });
    expect(volumeCount(backup)).toBe(1);
    backup.close();
  });

  test('作業用の台帳がなければ、確認なしで復元できる', () => {
    const pair = setupPair(2, 2);
    pair.ledger.close();
    const missing = join(pair.dir, 'new-data', 'catalog.sqlite');
    const result = restoreFromSnapshot({
      workingPath: missing,
      snapshotPath: pair.snapshotPath,
      confirmed: false,
      now: T0,
    });
    expect(result).toEqual({ restoredRevision: 2, backupPath: undefined });
    const restored = openLedger(missing, { libraryId: LIBRARY_ID });
    expect(getRevision(restored.db)).toBe(2);
    restored.close();
  });

  test('スナップショットがなければ、エラー', () => {
    const dir = newDir();
    expect(() =>
      restoreFromSnapshot({
        workingPath: join(dir, 'a.sqlite'),
        snapshotPath: join(dir, 'none.sqlite'),
        confirmed: true,
        now: T0,
      })
    ).toThrow();
  });
});
