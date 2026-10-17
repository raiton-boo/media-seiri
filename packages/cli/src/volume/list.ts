import { CliError } from '../cli-error.ts';
import { buildVolumeInfo, parseDfAll } from './parse.ts';
import { type CommandRunner, defaultRunner } from './resolve.ts';
import type { VolumeInfo } from './types.ts';

/** ユーザーのデータが入っている、内蔵のボリュームのマウント先(仕様書 §9-1 の「内蔵のフォルダ」をソースにするため、一覧に含める) */
const DATA_VOLUME_MOUNT_POINT = '/System/Volumes/Data';

/** 一覧に出すか: 外付けのボリュームと、ユーザーのデータの内蔵ボリューム。システム用(`/`・VM・Preboot・Recovery など)は、除く */
export const isListedVolume = (volume: VolumeInfo): boolean =>
  !volume.isInternal || volume.mountPoint === DATA_VOLUME_MOUNT_POINT;

/**
 * 接続中のボリュームを、すべて調べる(`df` → 各デバイスを `diskutil`)。macOS だけに対応する。
 * 固有 ID がなく、識別できないボリュームは、除く。内蔵のデータのボリュームを先に、残りを、名前の順にする。
 */
export const listMountedVolumes = (
  runner: CommandRunner = defaultRunner,
  platform: string = process.platform
): VolumeInfo[] => {
  if (platform !== 'darwin') {
    throw new CliError('ドライブの一覧は、macOS だけに対応しています');
  }
  const df = runner(['df', '-Pk']);
  if (!df.ok) throw new CliError(`df が失敗しました: ${df.stderr.trim()}`);

  const volumes: VolumeInfo[] = [];
  for (const row of parseDfAll(df.stdout)) {
    const info = runner(['diskutil', 'info', '-plist', row.deviceNode]);
    if (!info.ok) continue;
    const json = runner(
      ['plutil', '-convert', 'json', '-o', '-', '-'],
      info.stdout
    );
    if (!json.ok) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json.stdout);
    } catch {
      continue;
    }
    try {
      volumes.push(buildVolumeInfo(parsed, row));
    } catch (error) {
      // 固有 ID がなく、識別できないボリュームは、一覧に載せない(ほかのものは、続ける)
      if (!(error instanceof CliError)) throw error;
    }
  }
  return volumes
    .filter(isListedVolume)
    .sort(
      (a, b) =>
        Number(b.mountPoint === DATA_VOLUME_MOUNT_POINT) -
          Number(a.mountPoint === DATA_VOLUME_MOUNT_POINT) ||
        a.label.localeCompare(b.label)
    );
};
