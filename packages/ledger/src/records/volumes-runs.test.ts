import { describe, expect, test } from 'bun:test';
import { openDb, seedRun, T0, T1 } from './fixtures.ts';
import { finishRun, getRun, listUnfinishedRuns, startRun } from './runs.ts';
import { findVolumeByUuid, getVolume, upsertVolume } from './volumes.ts';

describe('volumes', () => {
  test('追加して、固有 ID と ID の両方で探せる', () => {
    const db = openDb();
    const volume = upsertVolume(db, {
      volumeUuid: 'uuid-1',
      label: '外付け',
      fsType: 'exfat',
      mediaKind: 'hdd',
      seenAt: T0,
    });
    expect(volume).toEqual({
      volumeId: expect.any(Number),
      volumeUuid: 'uuid-1',
      label: '外付け',
      fsType: 'exfat',
      mediaKind: 'hdd',
      lastSeenAt: '2026-10-18T00:00:00.000Z',
    });
    expect(getVolume(db, volume.volumeId)).toEqual(volume);
    expect(findVolumeByUuid(db, 'uuid-1')).toEqual(volume);
    expect(findVolumeByUuid(db, 'none')).toBeUndefined();
    expect(getVolume(db, 999)).toBeUndefined();
  });

  test('同じ固有 ID は、同じ行。最後に見た時刻だけ更新し、指定のない項目は残す', () => {
    const db = openDb();
    const first = upsertVolume(db, {
      volumeUuid: 'uuid-1',
      label: '外付け',
      mediaKind: 'usb',
      seenAt: T0,
    });
    const second = upsertVolume(db, { volumeUuid: 'uuid-1', seenAt: T1 });
    expect(second.volumeId).toBe(first.volumeId);
    expect(second.label).toBe('外付け');
    expect(second.mediaKind).toBe('usb');
    expect(second.lastSeenAt).toBe('2026-10-18T01:00:00.000Z');
  });

  test('ラベルが変わったら、新しい値にする', () => {
    const db = openDb();
    upsertVolume(db, { volumeUuid: 'u', label: '旧', seenAt: T0 });
    expect(
      upsertVolume(db, { volumeUuid: 'u', label: '新', seenAt: T0 }).label
    ).toBe('新');
  });

  test('不正な時刻は、エラー', () => {
    expect(() =>
      upsertVolume(openDb(), { volumeUuid: 'u', seenAt: new Date('x') })
    ).toThrow(RangeError);
  });
});

describe('runs', () => {
  test('始めると running。終えると、状態・終了時刻・リビジョンが入る', () => {
    const db = openDb();
    const { volumeId, runId } = seedRun(db);
    expect(getRun(db, runId)).toEqual({
      runId,
      sourceVolumeId: volumeId,
      isDryRun: false,
      status: 'running',
      startedAt: '2026-10-18T00:00:00.000Z',
      finishedAt: null,
      revisionAfter: null,
    });
    finishRun(db, runId, {
      status: 'completed',
      finishedAt: T1,
      revisionAfter: 3,
    });
    expect(getRun(db, runId)).toMatchObject({
      status: 'completed',
      finishedAt: '2026-10-18T01:00:00.000Z',
      revisionAfter: 3,
    });
  });

  test('dry-run は、真偽で読める', () => {
    const db = openDb();
    const { runId } = seedRun(db, { isDryRun: true });
    expect(getRun(db, runId)?.isDryRun).toBe(true);
  });

  test('ない実行を終えると、エラー。ない実行は、undefined', () => {
    const db = openDb();
    expect(() =>
      finishRun(db, 999, { status: 'failed', finishedAt: T1 })
    ).toThrow();
    expect(getRun(db, 999)).toBeUndefined();
  });

  test('終わっていない実行だけを、新しい順に探す(再開用)', () => {
    const db = openDb();
    const { volumeId, runId: running } = seedRun(db);
    const interrupted = startRun(db, {
      sourceVolumeId: volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    finishRun(db, interrupted, { status: 'interrupted', finishedAt: T1 });
    const completed = startRun(db, {
      sourceVolumeId: volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    finishRun(db, completed, { status: 'completed', finishedAt: T1 });
    const other = seedRun(db, { uuid: 'vol-2' });

    expect(listUnfinishedRuns(db, volumeId).map((run) => run.runId)).toEqual([
      interrupted,
      running,
    ]);
    expect(
      listUnfinishedRuns(db, other.volumeId).map((run) => run.runId)
    ).toEqual([other.runId]);
  });
});
