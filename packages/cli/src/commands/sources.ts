import { listSourceHistory } from '@file-seiri/ledger';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { formatLocalTime } from '../log/format.ts';
import { openLibraryReadOnly } from '../log/open.ts';
import { showReport } from '../present/index.ts';
import { formatTable } from '../table.ts';

const HEADER = [
  '取り込み元',
  '形式',
  '取り込み回数',
  '取り込み済み',
  '最後の取り込み',
  'dry-run',
];

/**
 * `sources [--library <パス>]`: 取り込み元(ドライブ・SD カードなど)ごとの履歴。
 * 同じ取り込み元を、また取り込むとき、これまでに何回・何ファイルを取り込んだかが、分かる(取り込み済みのファイルは、スキップされる)。
 */
export const sourcesCommand = async (
  context: CommandContext,
  libraryOption: string | undefined
): Promise<ExitCode> => {
  const { ledger, root } = await openLibraryReadOnly(context, libraryOption);
  try {
    const rows = listSourceHistory(ledger.db).map((row) => [
      row.label || row.volumeUuid.slice(0, 8),
      row.fsType ?? '-',
      `${row.runs} 回`,
      `${row.filesDone.toLocaleString('en-US')} ファイル`,
      row.lastStartedAt
        ? formatLocalTime(row.lastStartedAt, context.timeZone).slice(0, 16)
        : '-',
      `${row.dryRuns} 回`,
    ]);
    if (rows.length === 0) {
      context.stdout('まだ、取り込みの記録が、ありません。');
      return EXIT_CODES.ok;
    }
    if (context.fancy) {
      showReport(context, {
        title: '取り込み元ごとの履歴',
        badge: { label: `${rows.length} 件`, tone: 'info' },
        sections: [
          {
            title: root,
            tone: 'info',
            table: { header: HEADER, rows },
          },
        ],
        hint: '同じ取り込み元を、また取り込むと、取り込み済みのファイルは、スキップされます',
      });
    } else {
      for (const line of formatTable(HEADER, rows)) context.stdout(line);
    }
    return EXIT_CODES.ok;
  } finally {
    ledger.close();
  }
};
