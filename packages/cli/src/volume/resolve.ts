import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { CliError } from '../cli-error.ts';
import { buildVolumeInfo, parseDf } from './parse.ts';
import type { VolumeInfo } from './types.ts';

/** 外のコマンドの実行。テストでは、差し替える */
export type CommandRunner = (
  command: readonly string[],
  stdin?: string
) => { ok: boolean; stdout: string; stderr: string };

export const defaultRunner: CommandRunner = (command, stdin) => {
  const result = Bun.spawnSync([...command], {
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

const runOrFail = (
  runner: CommandRunner,
  command: readonly string[],
  stdin?: string
): string => {
  const result = runner(command, stdin);
  if (!result.ok) {
    throw new CliError(
      `コマンドが失敗しました(${command.join(' ')}): ${result.stderr.trim()}`
    );
  }
  return result.stdout;
};

/**
 * パスが属するボリュームを調べる。パスは、実在するもの(シンボリックリンクは、実体にたどる)。
 * macOS だけに対応する(`df`・`diskutil`・`plutil`)。
 */
export const resolveVolume = (
  path: string,
  runner: CommandRunner = defaultRunner,
  platform: string = process.platform
): VolumeInfo => {
  if (platform !== 'darwin') {
    throw new CliError('ボリュームの識別は、macOS だけに対応しています');
  }
  const realPath = realpathSync(path);
  const df = parseDf(runOrFail(runner, ['df', '-Pk', realPath]));
  const plist = runOrFail(runner, [
    'diskutil',
    'info',
    '-plist',
    df.deviceNode,
  ]);
  const json = runOrFail(
    runner,
    ['plutil', '-convert', 'json', '-o', '-', '-'],
    plist
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CliError('diskutil の出力を、JSON にできませんでした');
  }
  return buildVolumeInfo(parsed, df);
};

/**
 * ボリューム内の相対パス(`/` 区切り)。台帳の `rel_path` に使う。
 * ボリュームの外のパスは、エラー。
 */
export const relativeToVolume = (
  volume: VolumeInfo,
  absolutePath: string
): string => {
  if (!isAbsolute(absolutePath)) {
    throw new CliError(`絶対パスではありません: ${absolutePath}`);
  }
  const path = relative(volume.rootPath, absolutePath);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new CliError(
      `パスが、ボリューム(${volume.label || volume.volumeUuid})の外です: ${absolutePath}`
    );
  }
  return path.split(sep).join('/');
};

/** 同じボリュームか(名前ではなく、固有 ID で比べる。保存先とソースが同じなら、実行を止める) */
export const isSameVolume = (a: VolumeInfo, b: VolumeInfo): boolean =>
  a.volumeUuid === b.volumeUuid;
