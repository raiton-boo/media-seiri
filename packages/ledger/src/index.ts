export { LedgerError, type LedgerErrorCode } from './errors.ts';
export {
  IN_MEMORY,
  type Ledger,
  type LedgerMode,
  type OpenLedgerOptions,
  openLedger,
} from './ledger.ts';
export {
  type AcquireResult,
  acquireLock,
  formatHolderId,
  INGEST_LOCK_NAME,
  isLockHeldBy,
  isLockStale,
  LOCK_CONFIG,
  type LockInfo,
  readLock,
  refreshLock,
  releaseLock,
} from './lock.ts';
export {
  getLibraryId,
  getMeta,
  getRevision,
  getSchemaVersion,
  incrementRevision,
  setMeta,
} from './meta.ts';
export { assertSchemaConsistent, getUserVersion, migrate } from './migrate.ts';
export {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  type Migration,
} from './migrations/index.ts';
export * from './records/index.ts';
export {
  compareWithSnapshot,
  createSnapshot,
  restoreFromSnapshot,
  SNAPSHOT_DIRECTORY,
  SNAPSHOT_FILE_NAME,
  type SnapshotStatus,
  snapshotPathOf,
} from './snapshot.ts';
export {
  acquireWriteLock,
  type HeartbeatOptions,
  LockLostError,
  newHolderId,
  type WriteLock,
  type WriteLockResult,
} from './write-lock.ts';
