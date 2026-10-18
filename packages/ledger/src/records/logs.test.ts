import { describe, expect, test } from 'bun:test';
import { countErrorsByCode, listErrors, recordError } from './error-records.ts';
import {
  lastEventId,
  levelsAtLeast,
  listEvents,
  listEventsAfter,
  recordEvent,
} from './events.ts';
import { openDb, seedRun, seedSourceFile, T0 } from './fixtures.ts';

describe('errors', () => {
  test('記録して、実行ごとに読める。コード別の件数も数えられる', () => {
    const db = openDb();
    const seed = seedRun(db);
    const file = seedSourceFile(db, seed);
    const first = recordError(db, {
      runId: seed.runId,
      sourceFileId: file,
      code: 'READ_FAILED',
      detail: 'I/O',
      occurredAt: T0,
    });
    recordError(db, { runId: seed.runId, code: 'READ_FAILED', occurredAt: T0 });
    recordError(db, { runId: seed.runId, code: 'EMPTY_FILE', occurredAt: T0 });
    const other = seedRun(db, { uuid: 'vol-2' });
    recordError(db, { runId: other.runId, code: 'EMPTY_FILE', occurredAt: T0 });

    const errors = listErrors(db, seed.runId);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toEqual({
      errorId: first,
      runId: seed.runId,
      sourceFileId: file,
      code: 'READ_FAILED',
      detail: 'I/O',
      occurredAt: '2026-10-18T00:00:00.000Z',
    });
    expect(errors[1]).toMatchObject({ sourceFileId: null, detail: '' });
    expect(countErrorsByCode(db, seed.runId)).toEqual({
      READ_FAILED: 2,
      EMPTY_FILE: 1,
    });
  });

  test('ない実行・ないファイルは、指せない', () => {
    const db = openDb();
    const seed = seedRun(db);
    expect(() =>
      recordError(db, { runId: 999, code: 'READ_FAILED', occurredAt: T0 })
    ).toThrow();
    expect(() =>
      recordError(db, {
        runId: seed.runId,
        sourceFileId: 999,
        code: 'READ_FAILED',
        occurredAt: T0,
      })
    ).toThrow();
  });
});

describe('events', () => {
  test('続きから読める(最初は 0)。件数も絞れる', () => {
    const db = openDb();
    const seed = seedRun(db);
    const ids = ['a', 'b', 'c'].map((message) =>
      recordEvent(db, {
        runId: seed.runId,
        level: 'INFO',
        code: 'SCAN',
        message,
        occurredAt: T0,
      })
    );
    const other = seedRun(db, { uuid: 'vol-2' });
    recordEvent(db, {
      runId: other.runId,
      level: 'INFO',
      code: 'SCAN',
      message: 'x',
      occurredAt: T0,
    });

    expect(listEventsAfter(db, seed.runId, 0).map((e) => e.message)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      listEventsAfter(db, seed.runId, ids[0] ?? 0).map((e) => e.message)
    ).toEqual(['b', 'c']);
    expect(listEventsAfter(db, seed.runId, ids[2] ?? 0)).toEqual([]);
    expect(listEventsAfter(db, seed.runId, 0, 2)).toHaveLength(2);
  });

  test('ファイルつきのイベントを、すべての項目で読める', () => {
    const db = openDb();
    const seed = seedRun(db);
    const file = seedSourceFile(db, seed);
    const id = recordEvent(db, {
      runId: seed.runId,
      sourceFileId: file,
      level: 'WARN',
      code: 'ZIP_DEPTH_EXCEEDED',
      message: '深すぎる',
      occurredAt: T0,
    });
    expect(listEventsAfter(db, seed.runId, 0)).toEqual([
      {
        eventId: id,
        runId: seed.runId,
        sourceFileId: file,
        level: 'WARN',
        code: 'ZIP_DEPTH_EXCEEDED',
        message: '深すぎる',
        occurredAt: '2026-10-18T00:00:00.000Z',
      },
    ]);
  });
});

describe('listEvents・lastEventId・levelsAtLeast', () => {
  const seed = () => {
    const db = openDb();
    const seedRun1 = seedRun(db);
    const other = seedRun(db, { uuid: 'vol-2' });
    const add = (
      runId: number,
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
      message: string
    ): number =>
      recordEvent(db, { runId, level, code: 'X', message, occurredAt: T0 });
    return { db, run: seedRun1.runId, other: other.runId, add };
  };

  test('レベルで絞れる(指定以上)。古い順。ほかの実行は、含めない', () => {
    const { db, run, other, add } = seed();
    add(run, 'DEBUG', 'd');
    add(run, 'INFO', 'i');
    add(run, 'WARN', 'w');
    add(run, 'ERROR', 'e');
    add(other, 'ERROR', 'other');
    expect(listEvents(db, { runId: run }).map((e) => e.message)).toEqual([
      'd',
      'i',
      'w',
      'e',
    ]);
    expect(
      listEvents(db, { runId: run, minLevel: 'INFO' }).map((e) => e.message)
    ).toEqual(['i', 'w', 'e']);
    expect(
      listEvents(db, { runId: run, minLevel: 'WARN' }).map((e) => e.message)
    ).toEqual(['w', 'e']);
    expect(
      listEvents(db, { runId: run, minLevel: 'ERROR' }).map((e) => e.message)
    ).toEqual(['e']);
  });

  test('続き(afterEventId)と件数(limit)で読める。最後の ID は、追いかけの開始位置', () => {
    const { db, run, add } = seed();
    const ids = ['a', 'b', 'c', 'd'].map((m) => add(run, 'INFO', m));
    expect(lastEventId(db, run)).toBe(ids[3] ?? -1);
    expect(
      listEvents(db, { runId: run, afterEventId: ids[1] ?? 0 }).map(
        (e) => e.message
      )
    ).toEqual(['c', 'd']);
    expect(
      listEvents(db, { runId: run, limit: 2 }).map((e) => e.message)
    ).toEqual(['a', 'b']);
    expect(listEvents(db, { runId: run, afterEventId: ids[3] ?? 0 })).toEqual(
      []
    );
    expect(lastEventId(db, 999)).toBe(0);
  });

  test('levelsAtLeast', () => {
    expect(levelsAtLeast('DEBUG')).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
    expect(levelsAtLeast('WARN')).toEqual(['WARN', 'ERROR']);
    expect(levelsAtLeast('ERROR')).toEqual(['ERROR']);
  });
});
