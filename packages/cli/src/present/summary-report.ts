import { formatBytes } from '../ingest/preflight.ts';
import {
  type CopyResult,
  formatElapsed,
  formatSpeed,
  type IngestSummary,
  type StopReason,
} from '../ingest/summary.ts';
import type { Report, Row, Section } from './report.ts';

const count = (value: number): string => value.toLocaleString('en-US');

const ratioOf = (value: number, total: number): number =>
  total === 0 ? 0 : value / total;

const STOP_MESSAGES: Record<StopReason, string> = {
  user: '中断しました(Ctrl-C)。--resume で、続きから実行できます',
  'lock-lost':
    'ロックを失ったため、安全に止めました(別の実行が、ロックを引き継ぎました)',
  'drive-removed':
    'ドライブが抜けた可能性があるため、中断しました。接続を確かめて、--resume で続けてください',
  'disk-full':
    '保存先の容量が足りなくなったため、中断しました。空きを作って、--resume で続けてください',
};

const errorCodes = (summary: IngestSummary): string => {
  const entries = Object.entries(summary.errorsByCode);
  if (summary.emptyFiles > 0) entries.push(['EMPTY_FILE', summary.emptyFiles]);
  return entries.map(([code, n]) => `${code} ${n}`).join(' / ');
};

/** 取り込み(または dry-run)の結果を、色つきの枠にする(文字だけの `formatSummary` と、同じ内容) */
export const summaryReport = (
  summary: IngestSummary,
  context: { source: string; destination: string; isDryRun: boolean }
): Report => {
  const errors = summary.errorFiles + summary.emptyFiles;
  const sections: Section[] = [];

  sections.push({
    title: '場所',
    rows: [
      { label: 'ソース', value: context.source },
      { label: '保存先', value: context.destination },
    ],
  });

  sections.push({
    title: `検出 ${count(summary.detected)} ファイル`,
    tone: 'info',
    rows: [
      {
        label: '写真',
        value: count(summary.photos),
        ratio: ratioOf(summary.photos, summary.detected),
      },
      {
        label: '動画',
        value: count(summary.videos),
        ratio: ratioOf(summary.videos, summary.detected),
      },
      {
        label: 'RAW',
        value: count(summary.raws),
        ratio: ratioOf(summary.raws, summary.detected),
      },
      {
        label: 'サイドカー',
        value: count(summary.sidecars),
        ratio: ratioOf(summary.sidecars, summary.detected),
      },
    ],
  });

  const duplicates = summary.duplicatesInLibrary + summary.duplicatesInRun;
  const copyRows: Row[] = [
    {
      label: 'コピー予定',
      value: `${count(summary.copyFiles)} ファイル  ${formatBytes(summary.copyBytes)}`,
      tone: 'ok',
    },
    {
      label: '重複スキップ',
      value: `${count(duplicates)} ファイル(ライブラリに既存 ${count(summary.duplicatesInLibrary)} / 今回の中 ${count(summary.duplicatesInRun)})`,
    },
  ];
  if (summary.alreadyDoneInRun > 0) {
    copyRows.push({
      label: '完了済み',
      value: `${count(summary.alreadyDoneInRun)} ファイル(再開。この実行で、前に完了したもの)`,
    });
  }
  if (summary.alreadyProcessed > 0) {
    copyRows.push({
      label: '処理済み',
      value: `${count(summary.alreadyProcessed)} ファイル(前の実行で処理済みのため、スキップ)`,
    });
  }
  sections.push({ title: 'コピー', tone: 'ok', rows: copyRows });

  const dateRows: Row[] = [
    {
      label: 'フォールバック',
      value: `${count(summary.fallbackJson + summary.fallbackFilename)} ファイル(json ${count(summary.fallbackJson)} / ファイル名 ${count(summary.fallbackFilename)})`,
    },
    {
      label: '日付なし・不正',
      value: `${count(summary.unknownNone + summary.unknownInvalid)} ファイル(なし ${count(summary.unknownNone)} / 不正 ${count(summary.unknownInvalid)})`,
      tone:
        summary.unknownNone + summary.unknownInvalid > 0 ? 'warn' : undefined,
    },
  ];
  if (summary.metadataUnreadable > 0) {
    dateRows.push({
      label: 'メタデータなし',
      value: `${count(summary.metadataUnreadable)} ファイル(読めなかった。日付は、ファイル名などで決めた)`,
      tone: 'warn',
    });
  }
  if (summary.corrupted > 0) {
    dateRows.push({
      label: '破損',
      value: `${count(summary.corrupted)} ファイル(修復 ${count(summary.repaired)} / 読み取り不可へ ${count(summary.corrupted - summary.repaired)})`,
      tone: 'warn',
    });
  }
  sections.push({ title: '日付と状態', tone: 'warn', rows: dateRows });

  const others = [
    `対象外 ${count(summary.unsupported)}`,
    `Takeout の json ${count(summary.takeoutJson)}`,
    `ZIP ${count(summary.archives)}(開いた ${count(summary.zipOpened)}${summary.zipWarnings > 0 ? ` / 警告 ${count(summary.zipWarnings)}` : ''})`,
    `除外 ${count(summary.excluded)}`,
  ];
  if (summary.orphanSidecars > 0)
    others.push(`RAW のない .xmp ${count(summary.orphanSidecars)}`);
  const otherRows: Row[] = [
    { label: '対象外など', value: others.join(' / '), tone: 'dim' },
    {
      label: 'ハッシュ',
      value: `計算 ${count(summary.hashComputed)} / キャッシュ ${count(summary.hashFromCache)}`,
      tone: 'dim',
    },
    {
      label: context.isDryRun ? '所要時間' : '解析の時間',
      value: formatElapsed(summary.elapsedMs),
      tone: 'dim',
    },
  ];
  if (summary.sequencedGroups > 0) {
    otherRows.push({
      label: '連番を付けた',
      value: `${count(summary.sequencedGroups)} グループ(同じ名前が、すでにあるため)`,
    });
  }
  sections.push({ title: 'そのほか', tone: 'dim', rows: otherRows });

  sections.push({
    title: 'エラー',
    tone: errors > 0 ? 'error' : 'ok',
    rows: [
      {
        label: errors > 0 ? 'エラー' : '状態',
        value:
          errors > 0
            ? `${count(errors)} ファイル(${errorCodes(summary)})`
            : 'エラーは、ありません',
        tone: errors > 0 ? 'error' : 'ok',
      },
    ],
  });

  if (summary.capacity) {
    const { requiredBytes, marginBytes, freeBytes, shortageBytes } =
      summary.capacity;
    sections.push({
      title: '容量',
      tone: shortageBytes === 0 ? 'ok' : 'error',
      rows: [
        {
          label: '必要な容量',
          value: `${formatBytes(requiredBytes)}(余裕分 ${formatBytes(marginBytes)} を含む)`,
        },
        {
          label: '保存先の空き',
          value: `${formatBytes(freeBytes)}  →  ${shortageBytes === 0 ? '足りています' : `${formatBytes(shortageBytes)} 足りません`}`,
          tone: shortageBytes === 0 ? 'ok' : 'error',
          ratio: ratioOf(requiredBytes, freeBytes),
        },
      ],
    });
  }
  if (summary.problems.length > 0) {
    sections.push({
      title: '問題',
      tone: 'error',
      lines: summary.problems.map(
        (problem) => `${problem.code}: ${problem.message}`
      ),
    });
  }

  return {
    title: '結果',
    badge: context.isDryRun
      ? { label: 'dry-run(コピーしません)', tone: 'warn' }
      : summary.problems.length > 0
        ? { label: '止めました', tone: 'error' }
        : { label: '取り込み', tone: 'ok' },
    sections,
    hint: context.isDryRun ? '本番は、--dry-run を外して実行します' : undefined,
  };
};

/** コピーの結果を、色つきの枠にする(文字だけの `formatCopyResult` と、同じ内容) */
export const copyResultReport = (result: CopyResult): Report => {
  const stopped = result.stopReason !== undefined;
  const failed = result.failed > 0;
  const sections: Section[] = [
    {
      title: 'コピー',
      tone: failed ? 'error' : stopped ? 'warn' : 'ok',
      rows: [
        {
          label: 'コピー済み',
          value: `${count(result.copied)} ファイル  ${formatBytes(result.copiedBytes)}`,
          tone: 'ok',
        },
        {
          label: '重複の記録',
          value: `${count(result.linkedDuplicates)} ファイル`,
        },
        {
          label: 'コピー失敗',
          value: `${count(result.failed)} ファイル`,
          tone: failed ? 'error' : undefined,
        },
        {
          label: 'コピーの時間',
          value: formatElapsed(result.elapsedMs),
          tone: 'dim',
        },
        ...(formatSpeed(result.copiedBytes, result.elapsedMs)
          ? [
              {
                label: '平均の速さ',
                value: formatSpeed(result.copiedBytes, result.elapsedMs) ?? '',
                tone: 'dim' as const,
              },
            ]
          : []),
      ],
    },
  ];
  if (result.stopReason) {
    sections.push({
      title: '中断',
      tone: 'warn',
      lines: [STOP_MESSAGES[result.stopReason]],
    });
  }
  return {
    title: 'コピーの結果',
    badge: stopped
      ? { label: '中断', tone: 'warn' }
      : failed
        ? { label: '失敗あり', tone: 'error' }
        : { label: '完了', tone: 'ok' },
    sections,
  };
};

type Totals = {
  sources: number;
  detected: number;
  photos: number;
  videos: number;
  raws: number;
  sidecars: number;
  copyFiles: number;
  copyBytes: number;
  duplicates: number;
  errors: number;
  copied: number;
  copiedBytes: number;
  copyFailed: number;
  hasCopy: boolean;
};

const sumUp = (summaries: readonly IngestSummary[]): Totals => {
  const totals: Totals = {
    sources: summaries.length,
    detected: 0,
    photos: 0,
    videos: 0,
    raws: 0,
    sidecars: 0,
    copyFiles: 0,
    copyBytes: 0,
    duplicates: 0,
    errors: 0,
    copied: 0,
    copiedBytes: 0,
    copyFailed: 0,
    hasCopy: false,
  };
  for (const summary of summaries) {
    totals.detected += summary.detected;
    totals.photos += summary.photos;
    totals.videos += summary.videos;
    totals.raws += summary.raws;
    totals.sidecars += summary.sidecars;
    totals.copyFiles += summary.copyFiles;
    totals.copyBytes += summary.copyBytes;
    totals.duplicates += summary.duplicatesInLibrary + summary.duplicatesInRun;
    totals.errors += summary.errorFiles + summary.emptyFiles;
    if (summary.copy) {
      totals.hasCopy = true;
      totals.copied += summary.copy.copied;
      totals.copiedBytes += summary.copy.copiedBytes;
      totals.copyFailed += summary.copy.failed;
    }
  }
  return totals;
};

/** 複数の取り込み元の、合計(文字だけの行) */
export const formatTotals = (
  summaries: readonly IngestSummary[],
  isDryRun: boolean
): string[] => {
  const t = sumUp(summaries);
  const line = (label: string, value: string): string =>
    `  ${label.padEnd(8, '　')}: ${value}`;
  return [
    '',
    `${isDryRun ? '[dry-run] ' : ''}合計(取り込み元 ${t.sources} 件)`,
    line(
      '検出',
      `${count(t.detected)} ファイル (写真 ${count(t.photos)} / 動画 ${count(t.videos)} / RAW ${count(t.raws)} / サイドカー ${count(t.sidecars)})`
    ),
    line(
      'コピー予定',
      `${count(t.copyFiles)} ファイル ${formatBytes(t.copyBytes)}`
    ),
    line('重複', `${count(t.duplicates)} ファイル`),
    line('エラー', `${count(t.errors)} ファイル`),
    ...(t.hasCopy
      ? [
          line(
            'コピー済み',
            `${count(t.copied)} ファイル ${formatBytes(t.copiedBytes)}(失敗 ${count(t.copyFailed)})`
          ),
        ]
      : []),
  ];
};

/** 複数の取り込み元の、合計(色つきの枠) */
export const totalsReport = (
  summaries: readonly IngestSummary[],
  isDryRun: boolean
): Report => {
  const t = sumUp(summaries);
  const rows: Row[] = [
    {
      label: '検出',
      value: `${count(t.detected)} ファイル(写真 ${count(t.photos)} / 動画 ${count(t.videos)} / RAW ${count(t.raws)} / サイドカー ${count(t.sidecars)})`,
    },
    {
      label: 'コピー予定',
      value: `${count(t.copyFiles)} ファイル  ${formatBytes(t.copyBytes)}`,
      tone: 'ok',
    },
    { label: '重複', value: `${count(t.duplicates)} ファイル` },
    {
      label: 'エラー',
      value: `${count(t.errors)} ファイル`,
      tone: t.errors > 0 ? 'error' : 'ok',
    },
  ];
  if (t.hasCopy) {
    rows.push({
      label: 'コピー済み',
      value: `${count(t.copied)} ファイル  ${formatBytes(t.copiedBytes)}(失敗 ${count(t.copyFailed)})`,
      tone: t.copyFailed > 0 ? 'error' : 'ok',
    });
  }
  return {
    title: '合計',
    badge: isDryRun
      ? { label: 'dry-run(コピーしません)', tone: 'warn' }
      : { label: `取り込み元 ${t.sources} 件`, tone: 'info' },
    sections: [
      { title: `取り込み元 ${t.sources} 件の合計`, tone: 'info', rows },
    ],
  };
};
