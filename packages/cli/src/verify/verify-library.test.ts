import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getOrCreateContent,
  insertFileGroup,
  insertLibraryFile,
  openLedger,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { makeTempDir } from '../test-helpers.ts';
import { verifyLibrary } from './verify-library.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const NOW = new Date('2026-10-18T00:00:00Z');
const sha = (text: string): string =>
  new Bun.CryptoHasher('sha256').update(text).digest('hex');

/** ライブラリの、ディスクと台帳(メモリ)を作る。`files`: 相対パス → 中身 */
const setup = (files: Record<string, string>) => {
  const { dir, cleanup } = makeTempDir();
  cleanups.push(cleanup);
  const ledger = openLedger(':memory:', { libraryId: 'abc' });
  const volume = upsertVolume(ledger.db, { volumeUuid: 'v', seenAt: NOW });
  const runId = startRun(ledger.db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  const hashed: string[] = [];
  for (const [relPath, content] of Object.entries(files)) {
    mkdirSync(join(dir, relPath, '..'), { recursive: true });
    writeFileSync(join(dir, relPath), content);
    const { content: row } = getOrCreateContent(ledger.db, {
      hash: sha(content),
      sizeBytes: Buffer.byteLength(content),
    });
    insertLibraryFile(ledger.db, {
      contentId: row.contentId,
      groupId: insertFileGroup(ledger.db, { stem: relPath, bucket: 'full' }),
      runId,
      relPath,
      bucket: 'full',
      createdAt: NOW,
    });
  }
  const verify = (options: Partial<Parameters<typeof verifyLibrary>[0]> = {}) =>
    verifyLibrary({
      db: ledger.db,
      libraryRoot: dir,
      hashFile: async (path) => {
        hashed.push(path);
        return sha(await Bun.file(path).text());
      },
      concurrency: 1,
      sampleRatio: 1,
      random: () => 0.5,
      shouldStop: () => false,
      ...options,
    });
  return { dir, ledger, verify, hashed };
};

describe('verifyLibrary', () => {
  test('すべて一致なら、一致だけ(未登録も、なし)', async () => {
    const { verify } = setup({
      '2024/03/a.jpg': 'AAA',
      '2024/03/b.jpg': 'BBBB',
    });
    const report = await verify();
    expect(report).toMatchObject({
      ledgerFiles: 2,
      checked: 2,
      matched: 2,
      mismatched: [],
      missing: [],
      unreadable: [],
      unregistered: [],
      stopped: false,
    });
    expect(report.bytesRead).toBe(7);
  });

  test('同じサイズで中身が違えば、ハッシュの不一致', async () => {
    const { dir, verify } = setup({ 'a.jpg': 'AAA' });
    writeFileSync(join(dir, 'a.jpg'), 'AAB');
    const report = await verify();
    expect(report.matched).toBe(0);
    expect(report.mismatched).toHaveLength(1);
    expect(report.mismatched[0]?.detail).toContain('ハッシュが違います');
  });

  test('サイズが違えば、読まずに(ハッシュを計算せずに)不一致', async () => {
    const { dir, verify, hashed } = setup({ 'a.jpg': 'AAA' });
    writeFileSync(join(dir, 'a.jpg'), 'AAAA');
    const report = await verify();
    expect(report.mismatched[0]?.detail).toContain(
      'サイズが違います(台帳 3 バイト、実際 4 バイト)'
    );
    expect(hashed).toEqual([]);
    expect(report.bytesRead).toBe(0);
  });

  test('ファイルがなければ、欠落', async () => {
    const { dir, verify } = setup({ 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    rmSync(join(dir, 'a.jpg'));
    const report = await verify();
    expect(report.missing.map((p) => p.relPath)).toEqual(['a.jpg']);
    expect(report.matched).toBe(1);
  });

  test('読めなければ、読み取り不可(検査できなかったものは、一致に数えない)', async () => {
    const { verify } = setup({ 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    const report = await verify({
      hashFile: async (path) => {
        if (path.endsWith('a.jpg')) throw new Error('I/O error');
        return sha('BBB');
      },
    });
    expect(report.unreadable.map((p) => p.relPath)).toEqual(['a.jpg']);
    expect(report.unreadable[0]?.detail).toContain('I/O error');
    expect(report.matched).toBe(1);
    expect(report.checked).toBe(2);
  });

  test('台帳にないファイルは、未登録(大文字小文字を区別せずに比べる。付属ファイル・一時ファイルは、除く)', async () => {
    const { dir, verify } = setup({ '2024/03/a.jpg': 'AAA' });
    writeFileSync(join(dir, '2024/03/stray.jpg'), 'x');
    writeFileSync(join(dir, '2024/03/._a.jpg'), 'x');
    writeFileSync(join(dir, '2024/03/.a.jpg.part'), 'x');
    writeFileSync(join(dir, '2024/03/A.JPG'), 'x'); // 台帳の a.jpg と、大文字小文字だけが違う(exFAT では、同じ名前)
    const report = await verify();
    expect(report.unregistered).toEqual(['2024/03/stray.jpg']);
  });

  test('抜き取り: 割合に応じた件数だけ検査する(未登録の探索は、全体)', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1)
      files[`f${String(index).padStart(2, '0')}.jpg`] = `content-${index}`;
    const { dir, verify, hashed } = setup(files);
    writeFileSync(join(dir, 'stray.jpg'), 'x');
    const report = await verify({ sampleRatio: 0.25 });
    expect(report.ledgerFiles).toBe(20);
    expect(report.checked).toBe(5);
    expect(hashed).toHaveLength(5);
    expect(report.unregistered).toEqual(['stray.jpg']);
  });

  test('並行数の上限を守る(HDD は 1)', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1)
      files[`f${index}.jpg`] = `c${index}`;
    for (const concurrency of [1, 4]) {
      const { verify } = setup(files);
      let running = 0;
      let peak = 0;
      await verify({
        concurrency,
        hashFile: async (path) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          return sha(await Bun.file(path).text());
        },
      });
      expect(peak).toBe(concurrency);
    }
  });

  test('中断の要求があれば、そこで止まる(stopped)。未登録は、調べない', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 6; index += 1)
      files[`f${index}.jpg`] = `c${index}`;
    const { dir, verify, hashed } = setup(files);
    writeFileSync(join(dir, 'stray.jpg'), 'x');
    const report = await verify({ shouldStop: () => hashed.length >= 2 });
    expect(report.stopped).toBe(true);
    expect(report.checked).toBe(2);
    expect(report.unregistered).toEqual([]);
  });

  test('台帳が空・ライブラリが空でも、動く。台帳もファイルも、変えない', async () => {
    const { ledger, verify } = setup({});
    expect(await verify()).toMatchObject({
      ledgerFiles: 0,
      checked: 0,
      matched: 0,
      unregistered: [],
    });
    expect(
      (
        ledger.db.query('SELECT count(*) AS n FROM library_files').get() as {
          n: number;
        }
      ).n
    ).toBe(0);
  });

  test('結果は、パスの順(並行しても)', async () => {
    const files: Record<string, string> = {};
    for (const name of ['c', 'a', 'd', 'b']) files[`${name}.jpg`] = name;
    const { dir, verify } = setup(files);
    for (const name of ['c', 'a', 'd', 'b'])
      writeFileSync(join(dir, `${name}.jpg`), 'X');
    const report = await verify({ concurrency: 4 });
    expect(report.mismatched.map((p) => p.relPath)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'd.jpg',
    ]);
  });
});
