import type { Database } from 'bun:sqlite';
import { openMemoryLedger } from '../test-helpers.ts';
import { getOrCreateContent } from './contents.ts';
import { startRun } from './runs.ts';
import { insertSourceFile, type SourceFileInput } from './source-files.ts';
import { upsertVolume } from './volumes.ts';

export const T0 = new Date('2026-10-18T00:00:00.000Z');
export const T1 = new Date('2026-10-18T01:00:00.000Z');

export const openDb = (): Database => openMemoryLedger().db;

/** ボリューム 1 つと、その実行 1 つ */
export const seedRun = (
  db: Database,
  options: { isDryRun?: boolean; uuid?: string } = {}
): { volumeId: number; runId: number } => {
  const volume = upsertVolume(db, {
    volumeUuid: options.uuid ?? 'vol-1',
    seenAt: T0,
  });
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: options.isDryRun ?? false,
    startedAt: T0,
  });
  return { volumeId: volume.volumeId, runId };
};

export const seedSourceFile = (
  db: Database,
  seed: { volumeId: number; runId: number },
  extra: Partial<SourceFileInput> = {}
): number =>
  insertSourceFile(db, {
    ...seed,
    relPath: 'DCIM/IMG_0001.JPG',
    sizeBytes: 100,
    mtimeMs: 1_700_000_000_123,
    kind: 'photo',
    ext: 'jpg',
    ...extra,
  });

let hashCounter = 0;
/** 呼ぶたびに、別のハッシュの内容を作って、ID を返す */
export const seedContent = (db: Database, sizeBytes = 100): number => {
  hashCounter += 1;
  const hash = String(hashCounter).padStart(64, '0');
  return getOrCreateContent(db, { hash, sizeBytes }).content.contentId;
};
