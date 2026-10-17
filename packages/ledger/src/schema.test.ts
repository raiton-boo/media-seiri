import type { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import { HASH_A, openMemoryLedger } from './test-helpers.ts';

const TABLES = [
  'album_events',
  'contents',
  'duplicate_links',
  'errors',
  'events',
  'file_groups',
  'hash_cache',
  'library_files',
  'locks',
  'media_metadata',
  'meta',
  'repair_attempts',
  'runs',
  'source_files',
  'volumes',
];

const NOW = '2026-10-18T00:00:00Z';

let db: Database;
beforeEach(() => {
  db = openMemoryLedger().db;
});

/** 追加して、新しい行の ID を返す */
const insert = (
  table: string,
  values: Record<string, string | number | null>
): number => {
  const columns = Object.keys(values);
  const result = db
    .query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    )
    .run(...Object.values(values));
  return Number(result.lastInsertRowid);
};

const addVolume = (uuid = 'vol-1'): number =>
  insert('volumes', { volume_uuid: uuid, last_seen_at: NOW });
const addRun = (volumeId: number): number =>
  insert('runs', { source_volume_id: volumeId, started_at: NOW });
let contentCounter = 0;
/** 呼ぶたびに、別のハッシュの内容を作る(`hash` を指定すれば、その値) */
const addContent = (hash?: string): number => {
  contentCounter += 1;
  return insert('contents', {
    hash: hash ?? String(contentCounter).padStart(64, '0'),
    size_bytes: 10,
  });
};
const addSourceFile = (
  runId: number,
  volumeId: number,
  extra: Record<string, string | number | null> = {}
): number =>
  insert('source_files', {
    run_id: runId,
    volume_id: volumeId,
    rel_path: 'DCIM/IMG_0001.JPG',
    size_bytes: 10,
    mtime_ms: 1_700_000_000_123,
    kind: 'photo',
    ext: 'jpg',
    ...extra,
  });
const addGroup = (): number =>
  insert('file_groups', { stem: '20240101_IMG_0001', bucket: 'full' });
const addLibraryFile = (
  contentId: number,
  groupId: number,
  runId: number,
  extra: Record<string, string | number | null> = {}
): number =>
  insert('library_files', {
    content_id: contentId,
    group_id: groupId,
    run_id: runId,
    rel_path: '2024/01/20240101_IMG_0001.jpg',
    bucket: 'full',
    created_at: NOW,
    ...extra,
  });

describe('テーブルとインデックス', () => {
  test('er.md の全テーブルがある', () => {
    const rows = db
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    expect(rows.map((row) => row.name)).toEqual(TABLES);
  });

  test('全テーブルが STRICT', () => {
    const rows = db
      .query(
        "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .all() as Array<{ name: string; strict: number }>;
    expect(rows.length).toBe(TABLES.length);
    for (const row of rows)
      expect([row.name, row.strict]).toEqual([row.name, 1]);
  });

  test('er.md §5 のインデックスがある', () => {
    const rows = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    for (const name of [
      'source_files_run_state',
      'library_files_album_event_id',
      'album_events_start_at',
      'media_metadata_taken_at',
      'media_metadata_date_precision',
      'media_metadata_date_source',
      'media_metadata_gps',
      'events_run_event',
      'source_files_identity',
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  test('外部キーの違反は、一つもない', () => {
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('一意の制約', () => {
  test('contents.hash は、重複できない', () => {
    addContent(HASH_A);
    expect(() => addContent(HASH_A)).toThrow();
  });

  test('contents.hash は、64 文字(SHA-256)', () => {
    expect(() => addContent('abc')).toThrow();
  });

  test('volumes.volume_uuid は、重複できない', () => {
    addVolume();
    expect(() => addVolume()).toThrow();
  });

  test('library_files.rel_path は、重複できない', () => {
    const run = addRun(addVolume());
    const content = addContent();
    const group = addGroup();
    addLibraryFile(content, group, run);
    expect(() => addLibraryFile(content, group, run)).toThrow();
  });

  test('同じ実行で、同じソースのファイルを 2 度記録できない', () => {
    const volume = addVolume();
    const run = addRun(volume);
    addSourceFile(run, volume);
    expect(() => addSourceFile(run, volume)).toThrow();
    // 別の実行なら、記録できる
    expect(() => addSourceFile(addRun(volume), volume)).not.toThrow();
  });

  test('ZIP の中の同じパスは、親が違えば別のファイル', () => {
    const volume = addVolume();
    const run = addRun(volume);
    const zipA = addSourceFile(run, volume, { rel_path: 'a.zip', ext: 'zip' });
    const zipB = addSourceFile(run, volume, { rel_path: 'b.zip', ext: 'zip' });
    const entry = { rel_path: 'a.zip', entry_path: 'x.jpg', zip_depth: 1 };
    addSourceFile(run, volume, { ...entry, container_id: zipA });
    expect(() =>
      addSourceFile(run, volume, { ...entry, container_id: zipA })
    ).toThrow();
    expect(() =>
      addSourceFile(run, volume, {
        ...entry,
        rel_path: 'b.zip',
        container_id: zipB,
      })
    ).not.toThrow();
  });

  test('スキップ側は、採用側を 1 つだけ指す', () => {
    const volume = addVolume();
    const run = addRun(volume);
    const source = addSourceFile(run, volume);
    const libraryFile = addLibraryFile(addContent(), addGroup(), run);
    const link = {
      skipped_source_file_id: source,
      adopted_library_file_id: libraryFile,
      created_at: NOW,
    };
    insert('duplicate_links', link);
    expect(() => insert('duplicate_links', link)).toThrow();
  });
});

describe('外部キー', () => {
  test('存在しない親は、指せない', () => {
    expect(() =>
      insert('runs', { source_volume_id: 999, started_at: NOW })
    ).toThrow();
    const volume = addVolume();
    expect(() => addSourceFile(999, volume)).toThrow();
    expect(() =>
      addSourceFile(addRun(volume), volume, { content_id: 999 })
    ).toThrow();
  });

  test('子がいる親は、消せない', () => {
    const volume = addVolume();
    addRun(volume);
    expect(() => db.query('DELETE FROM volumes').run()).toThrow();
  });

  test('できごとを消しても、写真は残り、できごとの指定だけが外れる', () => {
    const run = addRun(addVolume());
    const event = insert('album_events', {
      start_at: '2024-01-01T10:00:00',
      end_at: '2024-01-01T12:00:00',
      file_count: 1,
      rule: '4h',
      computed_revision: 1,
    });
    const libraryFile = addLibraryFile(addContent(), addGroup(), run, {
      album_event_id: event,
    });
    db.query('DELETE FROM album_events').run();
    const row = db
      .query(
        'SELECT album_event_id FROM library_files WHERE library_file_id = ?'
      )
      .get(libraryFile) as { album_event_id: number | null };
    expect(row.album_event_id).toBeNull();
  });

  test('代表の写真が消えても、できごとは残る(たがいに指し合う)', () => {
    const run = addRun(addVolume());
    const libraryFile = addLibraryFile(addContent(), addGroup(), run);
    insert('album_events', {
      start_at: '2024-01-01',
      end_at: '2024-01-01',
      file_count: 1,
      cover_library_file_id: libraryFile,
      rule: '4h',
      computed_revision: 1,
    });
    db.query('DELETE FROM library_files').run();
    expect(
      db.query('SELECT cover_library_file_id AS c FROM album_events').get()
    ).toEqual({
      c: null,
    });
  });
});

describe('CHECK(値の制限)', () => {
  test('真偽は、0 か 1', () => {
    const volume = addVolume();
    expect(() =>
      insert('runs', {
        source_volume_id: volume,
        started_at: NOW,
        is_dry_run: 2,
      })
    ).toThrow();
    expect(() =>
      insert('runs', {
        source_volume_id: volume,
        started_at: NOW,
        is_dry_run: 1,
      })
    ).not.toThrow();
  });

  test('runs.status', () => {
    const volume = addVolume();
    for (const status of ['running', 'completed', 'interrupted', 'failed']) {
      expect(() =>
        insert('runs', { source_volume_id: volume, started_at: NOW, status })
      ).not.toThrow();
    }
    expect(() =>
      insert('runs', {
        source_volume_id: volume,
        started_at: NOW,
        status: 'done',
      })
    ).toThrow();
  });

  test('volumes.media_kind は、NULL か hdd / ssd / usb', () => {
    expect(() =>
      insert('volumes', { volume_uuid: 'a', last_seen_at: NOW })
    ).not.toThrow();
    expect(() =>
      insert('volumes', {
        volume_uuid: 'b',
        last_seen_at: NOW,
        media_kind: 'usb',
      })
    ).not.toThrow();
    expect(() =>
      insert('volumes', {
        volume_uuid: 'c',
        last_seen_at: NOW,
        media_kind: 'cd',
      })
    ).toThrow();
  });

  test('source_files.state・kind', () => {
    const volume = addVolume();
    const run = addRun(volume);
    for (const state of [
      'scanned',
      'analyzed',
      'planned',
      'duplicate',
      'done',
      'error',
      'ignored',
    ]) {
      expect(() =>
        addSourceFile(run, volume, { state, rel_path: `p-${state}` })
      ).not.toThrow();
    }
    expect(() =>
      addSourceFile(run, volume, { state: 'x', rel_path: 'p1' })
    ).toThrow();
    expect(() =>
      addSourceFile(run, volume, { kind: 'audio', rel_path: 'p2' })
    ).toThrow();
  });

  test('source_files: 状態の既定値は scanned、負のサイズは不可', () => {
    const volume = addVolume();
    const id = addSourceFile(addRun(volume), volume);
    expect(
      db
        .query('SELECT state FROM source_files WHERE source_file_id = ?')
        .get(id)
    ).toEqual({ state: 'scanned' });
    expect(() =>
      addSourceFile(addRun(volume), volume, { size_bytes: -1 })
    ).toThrow();
  });

  test('source_files: container_id と entry_path は、そろって入る', () => {
    const volume = addVolume();
    const run = addRun(volume);
    const zip = addSourceFile(run, volume, { rel_path: 'a.zip', ext: 'zip' });
    expect(() =>
      addSourceFile(run, volume, { rel_path: 'a.zip', container_id: zip })
    ).toThrow();
    expect(() =>
      addSourceFile(run, volume, { rel_path: 'a.zip', entry_path: 'x.jpg' })
    ).toThrow();
  });

  test('更新日は、整数のミリ秒を持てる(JavaScript の数値の範囲で、正確に)', () => {
    const volume = addVolume();
    const id = addSourceFile(addRun(volume), volume, {
      mtime_ms: 1_700_000_000_123,
    });
    expect(
      db
        .query('SELECT mtime_ms FROM source_files WHERE source_file_id = ?')
        .get(id)
    ).toEqual({ mtime_ms: 1_700_000_000_123 });
  });

  test('bucket は、置き場所の区分だけ(file_groups・library_files)', () => {
    expect(() =>
      insert('file_groups', { stem: 's', bucket: 'misc' })
    ).toThrow();
    const run = addRun(addVolume());
    expect(() =>
      addLibraryFile(addContent(), addGroup(), run, { bucket: 'misc' })
    ).toThrow();
    for (const bucket of [
      'full',
      'time_unknown',
      'date_unknown',
      'md_unknown',
      'unknown_none',
      'unknown_invalid',
      'unknown_repaired_nodate',
      'unknown_unreadable',
    ]) {
      expect(() => insert('file_groups', { stem: 's', bucket })).not.toThrow();
    }
  });

  test('events.level', () => {
    const run = addRun(addVolume());
    const event = { run_id: run, code: 'X', message: 'm', occurred_at: NOW };
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR']) {
      expect(() => insert('events', { ...event, level })).not.toThrow();
    }
    expect(() => insert('events', { ...event, level: 'TRACE' })).toThrow();
  });

  test('errors.code は、制限しない(新しいコードを足しても、移行が要らない)', () => {
    const run = addRun(addVolume());
    expect(() =>
      insert('errors', { run_id: run, code: 'READ_FAILED', occurred_at: NOW })
    ).not.toThrow();
    expect(() =>
      insert('errors', { run_id: run, code: 'FUTURE_CODE', occurred_at: NOW })
    ).not.toThrow();
  });

  test('repair_attempts.method', () => {
    const volume = addVolume();
    const source = addSourceFile(addRun(volume), volume);
    const attempt = {
      source_file_id: source,
      is_success: 1,
      attempted_at: NOW,
    };
    expect(() =>
      insert('repair_attempts', { ...attempt, method: 'video_remux' })
    ).not.toThrow();
    expect(() =>
      insert('repair_attempts', { ...attempt, method: 'magic' })
    ).toThrow();
  });

  test('album_events: 件数は 1 以上、座標は範囲内', () => {
    const base = {
      start_at: '2024-01-01',
      end_at: '2024-01-01',
      rule: '4h',
      computed_revision: 1,
    };
    expect(() => insert('album_events', { ...base, file_count: 0 })).toThrow();
    expect(() =>
      insert('album_events', { ...base, file_count: 1, centroid_lat: 91 })
    ).toThrow();
    expect(() =>
      insert('album_events', { ...base, file_count: 1, centroid_lon: 135 })
    ).not.toThrow();
  });
});

describe('media_metadata', () => {
  const addMetadata = (extra: Record<string, string | number | null>): number =>
    insert('media_metadata', {
      content_id: addContent(),
      taken_at: '2024-01-01T10:00:00',
      date_precision: 'full',
      date_source: 'exif',
      ...extra,
    });

  test('通常の行を、追加できる(参考の更新日は、ミリ秒)', () => {
    const id = addMetadata({
      mtime_ref_ms: 1_700_000_000_123,
      gps_lat: 35.6,
      gps_lon: 139.7,
    });
    expect(
      db
        .query(
          'SELECT date_reason, mtime_ref_ms FROM media_metadata WHERE content_id = ?'
        )
        .get(id)
    ).toEqual({ date_reason: '', mtime_ref_ms: 1_700_000_000_123 });
  });

  test('date_precision・date_source の値', () => {
    expect(() => addMetadata({ date_precision: 'hour' })).toThrow();
    expect(() => addMetadata({ date_source: 'mtime' })).toThrow();
    for (const [precision, takenAt] of [
      ['date', '2024-01-01'],
      ['month', '2024-01'],
      ['year', '2024'],
    ] as const) {
      expect(() =>
        addMetadata({ date_precision: precision, taken_at: takenAt })
      ).not.toThrow();
    }
  });

  test('none・invalid のときだけ、taken_at が NULL', () => {
    expect(() =>
      addMetadata({
        date_precision: 'none',
        date_source: 'none',
        taken_at: null,
      })
    ).not.toThrow();
    expect(() =>
      addMetadata({ date_precision: 'invalid', taken_at: null })
    ).not.toThrow();
    expect(() =>
      addMetadata({ date_precision: 'none', taken_at: '2024' })
    ).toThrow();
    expect(() =>
      addMetadata({ date_precision: 'full', taken_at: null })
    ).toThrow();
  });

  test('座標・寸法の範囲', () => {
    expect(() => addMetadata({ gps_lat: -90.5 })).toThrow();
    expect(() => addMetadata({ gps_lon: 180.5 })).toThrow();
    expect(() => addMetadata({ width: -1 })).toThrow();
    expect(() => addMetadata({ duration_sec: -0.1 })).toThrow();
  });
});

describe('hash_cache', () => {
  test('キーは(ボリューム, 相対パス, サイズ, mtime)。mtime が違えば、別の行', () => {
    const volume = addVolume();
    const content = addContent();
    const key = {
      volume_id: volume,
      rel_path: 'DCIM/IMG_0001.JPG',
      size_bytes: 10,
      content_id: content,
      computed_at: NOW,
    };
    insert('hash_cache', { ...key, mtime_ms: 1000 });
    expect(() => insert('hash_cache', { ...key, mtime_ms: 1000 })).toThrow();
    expect(() =>
      insert('hash_cache', { ...key, mtime_ms: 1001 })
    ).not.toThrow();
  });
});

describe('locks', () => {
  test('ロックの名前は、1 つだけ', () => {
    const lock = {
      lock_name: 'ingest',
      holder: 'pid-1',
      acquired_at: NOW,
      heartbeat_at: NOW,
    };
    insert('locks', lock);
    expect(() => insert('locks', lock)).toThrow();
  });
});
