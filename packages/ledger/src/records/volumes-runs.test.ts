import { describe, expect, test } from 'bun:test';
import { openDb, seedRun, T0, T1 } from './fixtures.ts';
import {
  finishRun,
  getRun,
  interruptRunningRuns,
  listUnfinishedRuns,
  resumeRun,
  startRun,
} from './runs.ts';
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
      kind: 'ingest',
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

describe('resumeRun・interruptRunningRuns', () => {
  test('中断した実行を、同じ ID で再開できる(状態は running、終了時刻は消える)', () => {
    const db = openDb();
    const { runId } = seedRun(db);
    finishRun(db, runId, { status: 'interrupted', finishedAt: T1 });
    resumeRun(db, runId);
    expect(getRun(db, runId)).toMatchObject({
      status: 'running',
      finishedAt: null,
    });
  });

  test('完了・失敗した実行、dry-run、ない実行は、再開できない', () => {
    const db = openDb();
    const done = seedRun(db);
    finishRun(db, done.runId, { status: 'completed', finishedAt: T1 });
    expect(() => resumeRun(db, done.runId)).toThrow(
      '再開できる実行ではありません'
    );
    const failed = startRun(db, {
      sourceVolumeId: done.volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    finishRun(db, failed, { status: 'failed', finishedAt: T1 });
    expect(() => resumeRun(db, failed)).toThrow();
    const dry = startRun(db, {
      sourceVolumeId: done.volumeId,
      isDryRun: true,
      startedAt: T0,
    });
    finishRun(db, dry, { status: 'interrupted', finishedAt: T1 });
    expect(() => resumeRun(db, dry)).toThrow();
    expect(() => resumeRun(db, 999)).toThrow();
  });

  test('実行中のままの本実行だけを、まとめて interrupted にする(dry-run・完了済みは、そのまま)', () => {
    const db = openDb();
    const { volumeId, runId: running } = seedRun(db);
    const running2 = startRun(db, {
      sourceVolumeId: volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    const dry = startRun(db, {
      sourceVolumeId: volumeId,
      isDryRun: true,
      startedAt: T0,
    });
    const done = startRun(db, {
      sourceVolumeId: volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    finishRun(db, done, { status: 'completed', finishedAt: T0 });

    expect(interruptRunningRuns(db, T1).sort()).toEqual(
      [running, running2].sort()
    );
    expect(getRun(db, running)).toMatchObject({
      status: 'interrupted',
      finishedAt: '2026-10-18T01:00:00.000Z',
    });
    expect(getRun(db, dry)?.status).toBe('running');
    expect(getRun(db, done)?.status).toBe('completed');
    expect(interruptRunningRuns(db, T1)).toEqual([]);
  });
});

describe('実行の種類(kind)', () => {
  test('既定は取り込み。検査(verify)の実行は、再開の対象にも、未完了の一覧にも、含めない', () => {
    const db = openDb();
    const { volumeId, runId: ingest } = seedRun(db);
    const verify = startRun(db, {
      kind: 'verify',
      sourceVolumeId: volumeId,
      isDryRun: false,
      startedAt: T0,
    });
    expect(getRun(db, ingest)?.kind).toBe('ingest');
    expect(getRun(db, verify)?.kind).toBe('verify');
    expect(listUnfinishedRuns(db, volumeId).map((run) => run.runId)).toEqual([
      ingest,
    ]);
    finishRun(db, verify, { status: 'interrupted', finishedAt: T1 });
    expect(() => resumeRun(db, verify)).toThrow('再開できる実行ではありません');
  });

  test('知らない種類は、制約で断られる', () => {
    const db = openDb();
    const { volumeId } = seedRun(db);
    expect(() =>
      startRun(db, {
        kind: 'repair' as never,
        sourceVolumeId: volumeId,
        isDryRun: false,
        startedAt: T0,
      })
    ).toThrow();
  });
});
