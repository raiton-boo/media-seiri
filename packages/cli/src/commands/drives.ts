import { existsSync } from 'node:fs';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { formatBytes } from '../ingest/preflight.ts';
import { type FoundLibrary, findLibraries } from '../library/discover.ts';
import { type Section, showReport } from '../present/index.ts';
import { formatTable } from '../table.ts';
import type { VolumeInfo } from '../volume/index.ts';

const SHORT_ID_LENGTH = 8;

/** 種類: 内蔵 / 外付け、USB・SSD・HDD */
export const describeKind = (volume: VolumeInfo): string => {
  const place = volume.isInternal ? '内蔵' : '外付け';
  return volume.mediaKind === undefined
    ? place
    : `${place} / ${volume.mediaKind.toUpperCase()}`;
};

const formatDate = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const describeLibrary = (library: FoundLibrary): string => {
  const updated = library.lastUpdated
    ? `最終更新 ${formatDate(library.lastUpdated)}`
    : '更新なし';
  const note = library.registered ? '' : ' [この Mac に未登録]';
  return `${library.libraryId.slice(0, SHORT_ID_LENGTH)} (${updated}) ${library.root}${note}`;
};

/** 外付けの根は、浅く探す。内蔵のデータのボリュームは、根が `/` で、広すぎるため、探さない(設定に登録されたものだけ) */
const scanRootOf = (volume: VolumeInfo): string | undefined =>
  !volume.isInternal && existsSync(volume.mountPoint)
    ? volume.mountPoint
    : undefined;

/** `file-seiri drives`: 接続中のドライブの一覧(仕様書 §9-1) */
export const drivesCommand = (context: CommandContext): ExitCode => {
  const volumes = context.listVolumes();
  if (volumes.length === 0) {
    context.stdout('接続中のドライブが、見つかりません。');
    return EXIT_CODES.ok;
  }
  const config = readConfig(context.dataDir);
  const header = ['名前', '容量', '空き', '形式', '種類', '状態', 'ライブラリ'];
  const rows: string[][] = [];
  const sections: Section[] = [];
  for (const volume of volumes) {
    const libraries = findLibraries({
      mountPoint: volume.mountPoint,
      scanRoot: scanRootOf(volume),
      config,
    });
    const [first, ...others] = libraries;
    const usedRatio =
      volume.totalBytes === 0
        ? 0
        : (volume.totalBytes - volume.freeBytes) / volume.totalBytes;
    const freeRatio = 1 - usedRatio;
    sections.push({
      title: volume.label || volume.volumeUuid,
      tone: volume.isInternal ? 'dim' : 'info',
      rows: [
        { label: '種類', value: describeKind(volume) },
        {
          label: '容量',
          value: `空き ${formatBytes(volume.freeBytes)} / 全体 ${formatBytes(volume.totalBytes)}(使用 ${Math.round(usedRatio * 100)}%)`,
          ratio: usedRatio,
          tone: freeRatio < 0.03 ? 'error' : freeRatio < 0.1 ? 'warn' : 'ok',
        },
        { label: '形式', value: volume.fsType },
        {
          label: '状態',
          value: volume.isWritable ? '書き込み可' : '読み取り専用',
          tone: volume.isWritable ? 'ok' : 'warn',
        },
        {
          label: 'ライブラリ',
          value:
            libraries.length === 0
              ? 'なし'
              : libraries.map(describeLibrary).join('\n'),
          tone: libraries.length === 0 ? 'dim' : undefined,
        },
      ],
    });
    rows.push([
      volume.label || volume.volumeUuid,
      formatBytes(volume.totalBytes),
      formatBytes(volume.freeBytes),
      volume.fsType,
      describeKind(volume),
      volume.isWritable ? '書き込み可' : '読み取り専用',
      first ? describeLibrary(first) : '-',
    ]);
    // 2 つ目以降のライブラリは、続きの行に出す
    for (const library of others)
      rows.push(['', '', '', '', '', '', describeLibrary(library)]);
  }
  if (context.fancy) {
    showReport(context, {
      title: 'ドライブ',
      badge: { label: `${volumes.length} 台`, tone: 'info' },
      sections,
      hint: 'ドライブは、名前ではなく、固有 ID で識別します(同じ名前のドライブがあっても、取り違えません)',
    });
    return EXIT_CODES.ok;
  }
  for (const line of formatTable(header, rows)) context.stdout(line);
  context.stdout('');
  context.stdout(
    'ドライブは、名前ではなく、固有 ID で識別します(同じ名前のドライブがあっても、取り違えません)。'
  );
  return EXIT_CODES.ok;
};
