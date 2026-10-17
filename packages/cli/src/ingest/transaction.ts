/**
 * 台帳への書き込みの入口。まとめて 1 つのトランザクションにする。
 * dry-run では、普通のトランザクション。本実行では、ロックの保持者が、まだ自分かを確かめる
 * トランザクション(`WriteLock.transaction`)。ロックを失ったあとは、書き込まない。
 */
export type WriteTransaction = <T>(work: () => T) => T;
