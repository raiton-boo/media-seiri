import type { Database } from 'bun:sqlite';
import { LedgerError } from './errors.ts';
import { getSchemaVersion, setSchemaVersion } from './meta.ts';
import { MIGRATIONS, type Migration } from './migrations/index.ts';

type UserVersionRow = { user_version: number };

/** `PRAGMA user_version`。新しい DB は 0 */
export const getUserVersion = (db: Database): number =>
  db.query<UserVersionRow, []>('PRAGMA user_version').get()?.user_version ?? 0;

const assertSequential = (migrations: readonly Migration[]): void => {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `移行の番号が、1 から順に並んでいません: ${migration.version}(${migration.name})`
      );
    }
  });
};

/**
 * 未適用の移行を、番号の順に適用する。適用した移行の数を返す。
 *
 * 1 つの移行は、1 つのトランザクション。途中で失敗したら、その移行は、すべて取り消す。
 * 台帳のほうが新しいとき(`user_version` が、知っている最後の番号より大きい)は、エラー。
 */
export const migrate = (
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS
): number => {
  assertSequential(migrations);
  const latest = migrations.length;
  const current = getUserVersion(db);
  if (current > latest) {
    throw new LedgerError(
      'SCHEMA_TOO_NEW',
      `台帳のスキーマ(${current})が、このプログラムが扱える版(${latest})より新しい。プログラムを更新してください`
    );
  }

  const pending = migrations.slice(current);
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      // PRAGMA は、値を ? で渡せない。version は、上で整数と確かめた番号
      db.exec(`PRAGMA user_version = ${migration.version}`);
      setSchemaVersion(db, migration.version);
    })();
  }
  return pending.length;
};

/** `user_version` と `meta` の版が、同じであることを確かめる */
export const assertSchemaConsistent = (db: Database): void => {
  const userVersion = getUserVersion(db);
  const metaVersion = getSchemaVersion(db);
  if (metaVersion !== userVersion) {
    throw new LedgerError(
      'SCHEMA_INCONSISTENT',
      `user_version(${userVersion})と meta の schema_version(${metaVersion ?? 'なし'})が食い違っている`
    );
  }
};
