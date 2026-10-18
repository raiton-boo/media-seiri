import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { dropOverlappingSources } from '../ingest/sources.ts';
import { emptySummary } from '../ingest/summary.ts';
import {
  addPhoto,
  initLibrary,
  installExifWriter,
  makeWorld,
  runIn,
  type World,
} from '../ingest/test-support.ts';
import { renderReport } from './report-view.tsx';
import { formatTotals, summaryReport, totalsReport } from './summary-report.ts';

installExifWriter();

const worlds: World[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup();
});
const newWorld = async (): Promise<World> => {
  const world = makeWorld();
  worlds.push(world);
  await initLibrary(world);
  return world;
};

describe('結果の画面', () => {
  test('見出し・札・区画・行・ひと言が出る', () => {
    const text = renderReport(
      {
        title: '結果',
        badge: { label: 'dry-run', tone: 'warn' },
        sections: [
          {
            title: '場所',
            rows: [{ label: 'ソース', value: 'SD カード' }],
          },
          {
            title: '検出',
            rows: [{ label: '写真', value: '3', ratio: 0.5 }],
          },
          {
            title: '一覧',
            table: { header: ['実行', '状態'], rows: [['#1', '完了']] },
          },
        ],
        hint: '本番は、--dry-run を外します',
      },
      80
    );
    for (const expected of [
      'seiri',
      '結果',
      'dry-run',
      '場所',
      'SD カード',
      '写真',
      '実行',
      '#1',
      '本番は、--dry-run を外します',
    ])
      expect(text).toContain(expected);
  });

  test('取り込みの結果は、文字だけの表示と、同じ内容の項目を持つ', () => {
    const summary = { ...emptySummary(), detected: 4, photos: 4, copyFiles: 4 };
    const text = renderReport(
      summaryReport(summary, {
        source: 'A',
        destination: 'B',
        isDryRun: true,
      }),
      100
    );
    for (const expected of [
      '検出 4 ファイル',
      'コピー予定',
      '重複スキップ',
      'dry-run',
    ])
      expect(text).toContain(expected);
  });

  test('複数の取り込み元の合計', () => {
    const a = { ...emptySummary(), detected: 2, photos: 2, copyFiles: 2 };
    const b = { ...emptySummary(), detected: 3, photos: 3, copyFiles: 1 };
    expect(formatTotals([a, b], false).join('\n')).toContain('5 ファイル');
    expect(renderReport(totalsReport([a, b], true), 100)).toContain('合計');
  });
});

describe('取り込み元の重なり', () => {
  test('ほかの取り込み元の中にあるもの・同じ場所は、外す', () => {
    const result = dropOverlappingSources([
      '/a/photos/2020',
      '/a/photos',
      '/b',
      '/b/',
      '/c',
    ]);
    expect(result.kept).toEqual(['/a/photos', '/b', '/c']);
    expect(result.dropped.map((item) => item.source)).toEqual([
      '/a/photos/2020',
      '/b/',
    ]);
  });

  test('名前が似ているだけの別の場所は、外さない', () => {
    expect(dropOverlappingSources(['/a/photo', '/a/photos']).kept).toEqual([
      '/a/photo',
      '/a/photos',
    ]);
  });
});

describe('色つきの出力(端末のとき)', () => {
  test('状況・ライブラリ作成・ログが、枠で出る', async () => {
    const world = await newWorld();
    const status = await runIn(world, ['status'], { fancy: true });
    expect(status.code).toBe(0);
    expect(status.stdout.join('\n')).toContain('╭─');
    expect(status.stdout.join('\n')).toContain('状況');

    const created = await runIn(
      world,
      ['library', 'init', join(world.destDrive, 'Second')],
      { fancy: true, newLibraryId: () => 'lib-2' }
    );
    expect(created.stdout.join('\n')).toContain('ライブラリを作りました');
    expect(created.stdout.join('\n')).toContain('╭─');
  });

  test('失敗は、赤い札つき。「もしかして」も出る', async () => {
    const world = await newWorld();
    const result = await runIn(world, ['ingset'], { fancy: true });
    expect(result.code).toBe(2);
    const text = result.stderr.join('\n');
    expect(text).toContain('エラー');
    expect(text).toContain('もしかして');
    expect(text).toContain('ingest');
  });

  test('取り込みの結果が、枠で出る(dry-run)', async () => {
    const world = await newWorld();
    await addPhoto(world, 'DCIM/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    const result = await runIn(
      world,
      [
        'ingest',
        join(world.srcRoot, 'DCIM'),
        '--dest',
        world.library,
        '--dry-run',
      ],
      { fancy: true }
    );
    expect(result.code).toBe(0);
    const text = result.stdout.join('\n');
    expect(text).toContain('╭─ 検出 1 ファイル');
    expect(text).toContain('dry-run');
  });

  test('取り込み元を 2 つ指定すると、合計が出る。重なる取り込み元は、警告して外す', async () => {
    const world = await newWorld();
    await addPhoto(world, 'A/a.jpg', {
      DateTimeOriginal: '2024:03:05 10:20:30',
    });
    await addPhoto(world, 'B/b.jpg', {
      DateTimeOriginal: '2024:03:06 10:20:30',
    });
    const result = await runIn(world, [
      'ingest',
      join(world.srcRoot, 'A'),
      join(world.srcRoot, 'B'),
      join(world.srcRoot, 'B', 'inner'),
      '--dest',
      world.library,
      '--dry-run',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toContain('合計(取り込み元 2 件)');
    expect(result.stderr.join('\n')).toContain('重なるため');
  });
});
