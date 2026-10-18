import type { ErrorCode } from '@file-seiri/core';
import type { VolumeInfo } from '../volume/index.ts';
import {
  type CapacityEstimate,
  formatBytes,
  type Problem,
} from './preflight.ts';

/** 取り込み(または dry-run)の、件数のまとめ */
export type IngestSummary = {
  /** 台帳に記録した、対象のファイル(写真・RAW・動画・`.xmp`) */
  detected: number;
  photos: number;
  raws: number;
  videos: number;
  sidecars: number;
  /** コピー予定(重複・エラー・コピーしない `.xmp` を除く) */
  copyFiles: number;
  copyBytes: number;
  duplicatesInLibrary: number;
  duplicatesInRun: number;
  /** 前の実行で、処理済み(同じボリューム・パス・サイズ・更新日)のため、スキップしたもの */
  alreadyProcessed: number;
  /** 再開で、前回までに、この実行の中で完了していたもの */
  alreadyDoneInRun: number;
  fallbackJson: number;
  fallbackFilename: number;
  unknownNone: number;
  unknownInvalid: number;
  /** メタデータを読めなかった(破損とは限らない)。日付は、ファイル名・json で決めた */
  metadataUnreadable: number;
  orphanSidecars: number;
  /** 取り込みの対象外(件数のみ) */
  unsupported: number;
  takeoutJson: number;
  /** ZIP(入れ子を含む) */
  archives: number;
  /** 開いた ZIP の数(入れ子を含む) */
  zipOpened: number;
  /** ZIP のことで、警告にしたもの(入れ子が深すぎて、開かなかったもの) */
  zipWarnings: number;
  /** 管理用ファイル・除外した場所・シンボリックリンクなど */
  excluded: number;
  emptyFiles: number;
  errorFiles: number;
  errorsByCode: Partial<Record<ErrorCode, number>>;
  hashComputed: number;
  hashFromCache: number;
  sequencedGroups: number;
  capacity: CapacityEstimate | undefined;
  problems: Problem[];
  /** 本実行の、コピーの結果(dry-run では、undefined) */
  copy: CopyResult | undefined;
};

export type StopReason = 'user' | 'lock-lost' | 'drive-removed' | 'disk-full';

export type CopyResult = {
  copied: number;
  copiedBytes: number;
  failed: number;
  /** 重複として、採用側に結びつけた数(今回の中の重複) */
  linkedDuplicates: number;
  stopReason: StopReason | undefined;
};

export const emptySummary = (): IngestSummary => ({
  detected: 0,
  photos: 0,
  raws: 0,
  videos: 0,
  sidecars: 0,
  copyFiles: 0,
  copyBytes: 0,
  duplicatesInLibrary: 0,
  duplicatesInRun: 0,
  alreadyProcessed: 0,
  alreadyDoneInRun: 0,
  fallbackJson: 0,
  fallbackFilename: 0,
  unknownNone: 0,
  unknownInvalid: 0,
  metadataUnreadable: 0,
  orphanSidecars: 0,
  unsupported: 0,
  takeoutJson: 0,
  archives: 0,
  zipOpened: 0,
  zipWarnings: 0,
  excluded: 0,
  emptyFiles: 0,
  errorFiles: 0,
  errorsByCode: {},
  hashComputed: 0,
  hashFromCache: 0,
  sequencedGroups: 0,
  capacity: undefined,
  problems: [],
  copy: undefined,
});

/** ボリュームの説明: 名前 (形式 / 種類 / 空き) */
export const describeVolume = (volume: VolumeInfo): string => {
  const kind =
    volume.mediaKind === undefined
      ? ''
      : ` / ${volume.mediaKind.toUpperCase()}`;
  return `${volume.label || volume.volumeUuid} (${volume.fsType}${kind} / 空き ${formatBytes(volume.freeBytes)})`;
};

const count = (value: number): string => value.toLocaleString('en-US');
const line = (label: string, value: string): string =>
  `  ${label.padEnd(16, '　')}: ${value}`;

/** サマリーを、表示する行にする(`docs/features/dry-run.md` §4-1) */
export const formatSummary = (
  summary: IngestSummary,
  context: { source: string; destination: string; isDryRun: boolean }
): string[] => {
  const lines: string[] = [];
  lines.push(`${context.isDryRun ? '[dry-run] ' : ''}結果`);
  lines.push(line('ソース', context.source));
  lines.push(line('保存先', context.destination));
  lines.push('');
  lines.push(
    line(
      '検出',
      `${count(summary.detected)} ファイル (写真 ${count(summary.photos)} / 動画 ${count(summary.videos)} / RAW ${count(summary.raws)} / サイドカー ${count(summary.sidecars)})`
    )
  );
  lines.push(
    line(
      'コピー予定',
      `${count(summary.copyFiles)} ファイル ${formatBytes(summary.copyBytes)}`
    )
  );
  lines.push(
    line(
      '重複スキップ',
      `${count(summary.duplicatesInLibrary + summary.duplicatesInRun)} ファイル (ライブラリに既存 ${count(summary.duplicatesInLibrary)} / 今回の中 ${count(summary.duplicatesInRun)})`
    )
  );
  if (summary.alreadyDoneInRun > 0) {
    lines.push(
      line(
        '完了済み',
        `${count(summary.alreadyDoneInRun)} ファイル(再開。この実行で、前に完了したもの)`
      )
    );
  }
  if (summary.alreadyProcessed > 0) {
    lines.push(
      line(
        '処理済み',
        `${count(summary.alreadyProcessed)} ファイル(前の実行で処理済みのため、スキップ)`
      )
    );
  }
  lines.push(
    line(
      '日付フォールバック',
      `${count(summary.fallbackJson + summary.fallbackFilename)} ファイル (json ${count(summary.fallbackJson)} / ファイル名 ${count(summary.fallbackFilename)})`
    )
  );
  lines.push(
    line(
      '日付なし・不正',
      `${count(summary.unknownNone + summary.unknownInvalid)} ファイル (なし ${count(summary.unknownNone)} / 不正 ${count(summary.unknownInvalid)})`
    )
  );
  if (summary.metadataUnreadable > 0) {
    lines.push(
      line(
        'メタデータなし',
        `${count(summary.metadataUnreadable)} ファイル(読めなかった。日付は、ファイル名などで決めた)`
      )
    );
  }
  const excluded = [
    `対象外 ${count(summary.unsupported)}`,
    `Takeout の json ${count(summary.takeoutJson)}`,
    `ZIP ${count(summary.archives)}(開いた ${count(summary.zipOpened)}${summary.zipWarnings > 0 ? ` / 警告 ${count(summary.zipWarnings)}` : ''})`,
    `除外 ${count(summary.excluded)}`,
  ];
  if (summary.orphanSidecars > 0)
    excluded.push(`RAW のない .xmp ${count(summary.orphanSidecars)}`);
  lines.push(line('対象外など', excluded.join(' / ')));
  lines.push(
    line(
      'エラー',
      `${count(summary.errorFiles + summary.emptyFiles)} ファイル${formatErrorCodes(summary)}`
    )
  );
  lines.push(
    line(
      'ハッシュ',
      `計算 ${count(summary.hashComputed)} / キャッシュ ${count(summary.hashFromCache)}`
    )
  );
  if (summary.sequencedGroups > 0) {
    lines.push(
      line(
        '連番を付けた',
        `${count(summary.sequencedGroups)} グループ(同じ名前が、すでにあるため)`
      )
    );
  }

  if (summary.capacity) {
    const { requiredBytes, marginBytes, freeBytes, shortageBytes } =
      summary.capacity;
    lines.push('');
    lines.push(
      line(
        '必要な容量',
        `${formatBytes(requiredBytes)}(余裕分 ${formatBytes(marginBytes)} を含む)`
      )
    );
    lines.push(
      line(
        '保存先の空き',
        `${formatBytes(freeBytes)}  →  ${shortageBytes === 0 ? '足りています' : `${formatBytes(shortageBytes)} 足りません`}`
      )
    );
  }
  for (const problem of summary.problems) {
    lines.push('');
    lines.push(`問題(${problem.code}): ${problem.message}`);
  }
  return lines;
};

const formatErrorCodes = (summary: IngestSummary): string => {
  const entries = Object.entries(summary.errorsByCode);
  if (summary.emptyFiles > 0) entries.push(['EMPTY_FILE', summary.emptyFiles]);
  return entries.length === 0
    ? ''
    : ` (${entries.map(([code, n]) => `${code} ${n}`).join(' / ')})`;
};

const STOP_MESSAGES: Record<StopReason, string> = {
  user: '中断しました(Ctrl-C)。--resume で、続きから実行できます',
  'lock-lost':
    'ロックを失ったため、安全に止めました(別の実行が、ロックを引き継ぎました)',
  'drive-removed':
    'ドライブが抜けた可能性があるため、中断しました。接続を確かめて、--resume で続けてください',
  'disk-full':
    '保存先の容量が足りなくなったため、中断しました。空きを作って、--resume で続けてください',
};

/** 本実行のコピーの結果を、表示する行にする */
export const formatCopyResult = (result: CopyResult): string[] => {
  const lines = [
    '',
    line(
      'コピー済み',
      `${count(result.copied)} ファイル ${formatBytes(result.copiedBytes)}`
    ),
    line('重複の記録', `${count(result.linkedDuplicates)} ファイル`),
    line('コピー失敗', `${count(result.failed)} ファイル`),
  ];
  if (result.stopReason)
    lines.push('', `中断: ${STOP_MESSAGES[result.stopReason]}`);
  return lines;
};
