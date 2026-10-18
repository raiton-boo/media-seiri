import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type RunEnvironment, run } from './run.ts';

export const FIXED_NOW = new Date('2026-10-18T00:00:00.000Z');

/** 一時ディレクトリ(本物の `data/` や、ドライブには、触れない) */
export const makeTempDir = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'file-seiri-cli-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};

export type RunResult = { code: number; stdout: string[]; stderr: string[] };

/** コマンドを実行して、終了コードと出力を集める */
export const runCli = async (
  argv: string[],
  options: {
    dataDir: string;
    env?: Record<string, string | undefined>;
    newLibraryId?: () => string;
  }
): Promise<RunResult> => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const environment: RunEnvironment = {
    env: options.env ?? {},
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    now: () => FIXED_NOW,
    // 端末で `bun run test` を動かしても、本物の画面(メニュー・質問)を出さない
    isInteractive: false,
    fancy: false,
    viewerBundleDir: undefined,
    // この Mac の、本物のドライブは、見ない(試験では、ドライブなし。必要なら、差し替える)
    listVolumes: () => [],
    // ブラウザは、開かない(試験では、開いた回数を、確かめる)
    openBrowser: () => {},
    // 外のコマンドは、あるものとする(診断の試験で、差し替える)
    findTool: (name) => `/usr/bin/${name}`,
    newLibraryId: options.newLibraryId ?? (() => 'lib-1'),
  };
  const code = await run(['--data-dir', options.dataDir, ...argv], environment);
  return { code, stdout, stderr };
};
