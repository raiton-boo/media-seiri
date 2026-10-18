import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  openLedger,
  recordEvent,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { makeTempDir } from '../test-helpers.ts';
import { exportRunLog, runLogPath } from './export.ts';
import { formatEventLine, formatLocalTime } from './format.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('formatLocalTime', () => {
  test('UTC を、指定のタイムゾーンの YYYY-MM-DD HH:MM:SS にする(日付をまたぐ場合も)', () => {
    expect(formatLocalTime('2026-10-18T00:00:00.000Z', 'Asia/Tokyo')).toBe(
      '2026-10-18 09:00:00'
    );
    expect(formatLocalTime('2026-10-18T20:30:05.123Z', 'Asia/Tokyo')).toBe(
      '2026-10-19 05:30:05'
    );
    expect(formatLocalTime('2026-10-18T00:00:00.000Z', 'UTC')).toBe(
      '2026-10-18 00:00:00'
    );
    expect(
      formatLocalTime('2026-01-01T03:04:05.000Z', 'America/New_York')
    ).toBe('2025-12-31 22:04:05');
  });
});

describe('formatEventLine', () => {
  const event = (level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') => ({
    eventId: 1,
    runId: 7,
    sourceFileId: null,
    level,
    code: 'PLAN_COPY',
    message: 'a.jpg → 2024/03/a.jpg',
    occurredAt: '2026-10-18T00:00:00.000Z',
  });
  const plain = { timeZone: 'Asia/Tokyo', color: false };

  test('時刻・レベル(5 桁にそろえる)・実行・コード・メッセージ。色がなければ、制御文字を含まない', () => {
    expect(formatEventLine(event('INFO'), plain)).toBe(
      '2026-10-18 09:00:00 INFO  #7 PLAN_COPY a.jpg → 2024/03/a.jpg'
    );
    expect(formatEventLine(event('ERROR'), plain)).toBe(
      '2026-10-18 09:00:00 ERROR #7 PLAN_COPY a.jpg → 2024/03/a.jpg'
    );
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const) {
      expect(formatEventLine(event(level), plain)).not.toContain('\u001b');
    }
  });

  test('色を付けるときは、レベルだけに付ける(INFO は、色なし)', () => {
    const color = { timeZone: 'Asia/Tokyo', color: true };
    expect(formatEventLine(event('WARN'), color)).toContain(
      '\u001b[33mWARN \u001b[0m'
    );
    expect(formatEventLine(event('ERROR'), color)).toContain(
      '\u001b[31mERROR\u001b[0m'
    );
    expect(formatEventLine(event('DEBUG'), color)).toContain('\u001b[90m');
    expect(formatEventLine(event('INFO'), color)).not.toContain('\u001b');
  });
});

describe('exportRunLog', () => {
  const setup = () => {
    const { dir, cleanup } = makeTempDir();
    cleanups.push(cleanup);
    const ledger = openLedger(':memory:', { libraryId: 'lib' });
    const volume = upsertVolume(ledger.db, {
      volumeUuid: 'v',
      seenAt: new Date('2026-10-18T00:00:00Z'),
    });
    const runId = startRun(ledger.db, {
      sourceVolumeId: volume.volumeId,
      isDryRun: false,
      startedAt: new Date('2026-10-18T00:00:00Z'),
    });
    const add = (
      level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
      message: string
    ): void => {
      recordEvent(ledger.db, {
        runId,
        level,
        code: 'X',
        message,
        occurredAt: new Date('2026-10-18T00:00:00Z'),
      });
    };
    const exportLog = () =>
      exportRunLog({
        db: ledger.db,
        dataDir: dir,
        libraryId: 'lib',
        runId,
        timeZone: 'Asia/Tokyo',
      });
    return { dir, runId, add, exportLog };
  };

  test('data/libraries/<ID>/logs/run-<実行>.log に、すべてのレベル(DEBUG も)を、古い順に書く', () => {
    const { dir, runId, add, exportLog } = setup();
    add('DEBUG', 'd');
    add('INFO', 'i');
    add('ERROR', 'e');
    const path = exportLog();
    expect(path).toBe(runLogPath(dir, 'lib', runId));
    expect(path).toBe(
      join(dir, 'libraries', 'lib', 'logs', `run-${runId}.log`)
    );
    expect(readFileSync(path, 'utf8')).toBe(
      [
        `2026-10-18 09:00:00 DEBUG #${runId} X d`,
        `2026-10-18 09:00:00 INFO  #${runId} X i`,
        `2026-10-18 09:00:00 ERROR #${runId} X e`,
        '',
      ].join('\n')
    );
    // 一時ファイルは、残らない
    expect(readdirSync(join(dir, 'libraries', 'lib', 'logs'))).toEqual([
      `run-${runId}.log`,
    ]);
  });

  test('もう一度書くと、全体を書き直す(再開した実行の、前の分も含む)。イベントがなければ、空のファイル', () => {
    const { runId, add, exportLog } = setup();
    const empty = exportLog();
    expect(readFileSync(empty, 'utf8')).toBe('');
    add('INFO', 'first');
    exportLog();
    add('WARN', 'second');
    const path = exportLog();
    expect(readFileSync(path, 'utf8').trimEnd().split('\n')).toHaveLength(2);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain(`#${runId} X second`);
  });
});
