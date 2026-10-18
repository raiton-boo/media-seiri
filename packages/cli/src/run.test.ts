import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLibraryId, openLedger } from '@file-seiri/ledger';
import { configPathFor, ledgerPathFor } from './config/paths.ts';
import { readConfig } from './config/registry.ts';
import { EXIT_CODES } from './exit-codes.ts';
import { markerPathOf, readMarker } from './library/marker.ts';
import { run } from './run.ts';
import { FIXED_NOW, makeTempDir, runCli } from './test-helpers.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 作業用の領域(data/)と、保存先のドライブの代わりの、2 つの一時ディレクトリ */
const setup = (): { dataDir: string; drive: string } => {
  const data = makeTempDir();
  const drive = makeTempDir();
  cleanups.push(data.cleanup, drive.cleanup);
  return { dataDir: join(data.dir, 'data'), drive: drive.dir };
};

describe('使い方', () => {
  test('打ち間違えたコマンド・オプションには、「もしかして」を出す', async () => {
    const { dataDir } = setup();
    const command = await runCli(['ingset'], { dataDir });
    expect(command.code).toBe(EXIT_CODES.failed);
    expect(command.stderr.join('\n')).toContain('もしかして: ingest');

    const option = await runCli(['ingest', '--dry-rn'], { dataDir });
    expect(option.stderr.join('\n')).toContain('もしかして: --dry-run');

    const far = await runCli(['zzzzzz'], { dataDir });
    expect(far.stderr.join('\n')).not.toContain('もしかして');
  });

  test('コマンドごとの --help は、意味・オプション・例を出す', async () => {
    const { dataDir } = setup();
    const result = await runCli(['ingest', '--help'], { dataDir });
    const text = result.stdout.join('\n');
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(text).toContain('seiri ingest');
    expect(text).toContain('--dry-run');
    expect(text).toContain('例');
  });

  test('help <コマンド> も、同じ説明を出す', async () => {
    const { dataDir } = setup();
    const result = await runCli(['help', 'viewer'], { dataDir });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('--snapshot');
  });

  test('知らないコマンドの help は、一覧つきの失敗(2)', async () => {
    const { dataDir } = setup();
    const result = await runCli(['help', 'nothing'], { dataDir });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('知らないコマンド');
  });

  test('--version は、バージョンを出す', async () => {
    const { dataDir } = setup();
    const result = await runCli(['--version'], { dataDir });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toMatch(/^seiri \d+\.\d+\.\d+/);
  });

  test('--help は、説明を出して、0', async () => {
    const { dataDir } = setup();
    const result = await runCli(['--help'], { dataDir });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('library init');
  });

  test('コマンドがなければ、説明を出して、2', async () => {
    const result = await runCli([], { dataDir: setup().dataDir });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stdout.join('\n')).toContain('使い方');
  });

  test('知らないコマンド・オプションは、2(エラーの表示つき)', async () => {
    const { dataDir } = setup();
    for (const argv of [
      ['nothing'],
      ['library'],
      ['library', 'init', 'a', 'b'],
      ['library', 'init', '--bogus'],
    ]) {
      const result = await runCli(argv, { dataDir });
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(result.stderr.join('\n')).toContain('エラー');
    }
  });

  test('環境変数でも、data/ の場所を指定できる', async () => {
    const { dataDir, drive } = setup();
    const stdout: string[] = [];
    const code = await run(['library', 'init', join(drive, 'Pictures')], {
      env: { FILE_SEIRI_DATA_DIR: dataDir },
      stdout: (text) => stdout.push(text),
      stderr: () => {},
      now: () => FIXED_NOW,
      newLibraryId: () => 'env-lib',
    });
    expect(code).toBe(EXIT_CODES.ok);
    expect(existsSync(ledgerPathFor(dataDir, 'env-lib'))).toBe(true);
  });
});

describe('library init', () => {
  test('目印・台帳・設定ができる(保存先のフォルダも作る)', async () => {
    const { dataDir, drive } = setup();
    const root = join(drive, 'Pictures');
    const result = await runCli(['library', 'init', root], { dataDir });
    expect(result.code).toBe(EXIT_CODES.ok);
    expect(result.stdout.join('\n')).toContain('lib-1');

    expect(readMarker(root)).toEqual({
      libraryId: 'lib-1',
      createdAt: FIXED_NOW.toISOString(),
      schemaVersion: expect.any(Number),
    });
    expect(existsSync(join(root, '.file-seiri'))).toBe(true);
    expect(readConfig(dataDir).libraries['lib-1']).toEqual({
      root,
      registeredAt: FIXED_NOW.toISOString(),
    });

    const ledger = openLedger(ledgerPathFor(dataDir, 'lib-1'), {
      mode: 'readonly',
    });
    expect(getLibraryId(ledger.db)).toBe('lib-1');
    ledger.close();
  });

  test('台帳のスキーマの版が、目印に入る', async () => {
    const { dataDir, drive } = setup();
    await runCli(['library', 'init', drive], { dataDir });
    const ledger = openLedger(ledgerPathFor(dataDir, 'lib-1'), {
      mode: 'readonly',
    });
    const version = (
      ledger.db.query('PRAGMA user_version').get() as { user_version: number }
    ).user_version;
    ledger.close();
    expect(readMarker(drive)?.schemaVersion).toBe(version);
  });

  test('相対パスは、実行した場所からの、絶対パスにして記録する', async () => {
    const { dataDir, drive } = setup();
    const previous = process.cwd();
    process.chdir(drive);
    try {
      expect(
        (await await runCli(['library', 'init', 'rel'], { dataDir })).code
      ).toBe(EXIT_CODES.ok);
    } finally {
      process.chdir(previous);
    }
    const root = readConfig(dataDir).libraries['lib-1']?.root ?? '';
    expect(root.endsWith('/rel')).toBe(true);
    expect(root.startsWith('/')).toBe(true);
  });

  test('パスがなければ、2', async () => {
    const result = await runCli(['library', 'init'], {
      dataDir: setup().dataDir,
    });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('使い方');
  });

  test('すでにライブラリなら、2。目印も台帳も、増やさない', async () => {
    const { dataDir, drive } = setup();
    await runCli(['library', 'init', drive], { dataDir });
    const second = await runCli(['library', 'init', drive], {
      dataDir,
      newLibraryId: () => 'lib-2',
    });
    expect(second.code).toBe(EXIT_CODES.failed);
    expect(second.stderr.join('\n')).toContain('lib-1');
    expect(readMarker(drive)?.libraryId).toBe('lib-1');
    expect(readdirSync(join(dataDir, 'libraries'))).toEqual(['lib-1']);
    expect(Object.keys(readConfig(dataDir).libraries)).toEqual(['lib-1']);
  });

  test('2 つ目の別のライブラリを作ると、設定に両方が並ぶ', async () => {
    const { dataDir, drive } = setup();
    const other = makeTempDir();
    cleanups.push(other.cleanup);
    await runCli(['library', 'init', drive], { dataDir });
    await runCli(['library', 'init', other.dir], {
      dataDir,
      newLibraryId: () => 'lib-2',
    });
    expect(Object.keys(readConfig(dataDir).libraries).sort()).toEqual([
      'lib-1',
      'lib-2',
    ]);
  });

  test('作業用の領域と重なる場所は、2(中・同じ・外側)', async () => {
    const { dataDir } = setup();
    mkdirSync(dataDir, { recursive: true });
    for (const target of [
      dataDir,
      join(dataDir, 'inner'),
      join(dataDir, '..'),
    ]) {
      const result = await runCli(['library', 'init', target], { dataDir });
      expect(result.code).toBe(EXIT_CODES.failed);
      expect(result.stderr.join('\n')).toContain('重なる');
    }
    expect(existsSync(join(dataDir, 'libraries'))).toBe(false);
  });

  test('フォルダでないパスは、2', async () => {
    const { dataDir, drive } = setup();
    const file = join(drive, 'file.txt');
    writeFileSync(file, 'x');
    expect(
      (await await runCli(['library', 'init', file], { dataDir })).code
    ).toBe(EXIT_CODES.failed);
  });

  test('目印が壊れているフォルダは、2(上書きしない)', async () => {
    const { dataDir, drive } = setup();
    writeFileSync(markerPathOf(drive), 'broken');
    const result = await runCli(['library', 'init', drive], { dataDir });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr.join('\n')).toContain('目印');
  });

  test('設定が壊れていて、失敗したら、作ったものをすべて取り消す(保存先のフォルダも)', async () => {
    const { dataDir, drive } = setup();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPathFor(dataDir), 'broken');
    const root = join(drive, 'new', 'Pictures');
    const result = await runCli(['library', 'init', root], { dataDir });
    expect(result.code).toBe(EXIT_CODES.failed);
    expect(existsSync(markerPathOf(root))).toBe(false);
    expect(existsSync(join(drive, 'new'))).toBe(true);
    expect(existsSync(root)).toBe(false);
    expect(existsSync(join(dataDir, 'libraries', 'lib-1'))).toBe(false);
    // 壊れた設定は、そのまま残る(上書きして、失わない)
    expect(Bun.file(configPathFor(dataDir)).size).toBe(6);
  });

  test('すでにあったフォルダは、失敗しても、消さない(中身も残る)', async () => {
    const { dataDir, drive } = setup();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPathFor(dataDir), 'broken');
    writeFileSync(join(drive, 'keep.txt'), 'x');
    expect(
      (await await runCli(['library', 'init', drive], { dataDir })).code
    ).toBe(EXIT_CODES.failed);
    expect(existsSync(join(drive, 'keep.txt'))).toBe(true);
    expect(existsSync(markerPathOf(drive))).toBe(false);
    expect(existsSync(join(drive, '.file-seiri'))).toBe(false);
  });

  test('作った台帳は、書き込み用に開き直せる', async () => {
    const { dataDir, drive } = setup();
    await runCli(['library', 'init', drive], { dataDir });
    const ledger = openLedger(ledgerPathFor(dataDir, 'lib-1'), {
      libraryId: 'lib-1',
    });
    expect(getLibraryId(ledger.db)).toBe('lib-1');
    ledger.close();
  });
});
