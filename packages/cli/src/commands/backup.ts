import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createSnapshot,
  getRevision,
  openLedger,
  snapshotPathOf,
} from '@file-seiri/ledger';
import cliPackage from '../../package.json' with { type: 'json' };
import { CliError } from '../cli-error.ts';
import { configPathFor, ledgerPathFor } from '../config/paths.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { formatBytes } from '../ingest/preflight.ts';
import { listRegisteredLibraries } from '../library/choose.ts';
import { showReport } from '../present/index.ts';
import { thumbsDirFor } from '../thumbs/index.ts';

export type BackupArguments = {
  /** バックアップを置く場所(この中に、`backup-<日時>/` を作る)。省くと、`<data>/backups/` */
  to: string | undefined;
  /** この Mac のサムネイルも、含める(大きい) */
  withThumbs: boolean;
  /** 一覧を見る(作らない) */
  list: boolean;
  library: string | undefined;
};

/** スナップショットと、この Mac の台帳の、突き合わせの結果 */
type Comparison =
  | 'same'
  | 'drive-newer'
  | 'mac-newer'
  | 'no-snapshot'
  | 'disconnected';

const COMPARISON_LABELS: Record<Comparison, string> = {
  same: '同じ(最新)',
  'drive-newer':
    'ドライブのスナップショットのほうが新しい(別の Mac で取り込んだ?)',
  'mac-newer':
    'この Mac の台帳のほうが新しい(seiri events で、スナップショットを最新にできます)',
  'no-snapshot': 'ドライブに、スナップショットがありません',
  disconnected: 'ドライブが接続されていません(突き合わせできません)',
};

type BackupEntry = {
  id: string;
  root: string;
  revision: number;
  runs: number;
  files: number;
  snapshotRevision: number | null;
  comparison: Comparison;
};

const compactTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

const sizeOf = (path: string): number => {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? sizeOf(child) : statSync(child).size;
  }
  return total;
};

/** 既存のバックアップの一覧(新しい順) */
const listBackups = (base: string): string[] =>
  existsSync(base)
    ? readdirSync(base, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && entry.name.startsWith('backup-')
        )
        .map((entry) => entry.name)
        .sort()
        .reverse()
    : [];

/**
 * `backup [--to <場所>] [--with-thumbs] [--library <パス>] [--list]`:
 * この Mac の `data/`(設定・ライブラリごとの台帳)を、日時つきのフォルダへ、バックアップする。
 * 台帳は、動いている最中でも、壊れない形(`VACUUM INTO`)で、コピーする。あわせて、ドライブのスナップショットと、突き合わせる。
 * ライブラリのドライブには、何も書かない。復元は、バックアップの中身を、`data/` へ、コピーし直す。
 */
export const backupCommand = async (
  context: CommandContext,
  args: BackupArguments
): Promise<ExitCode> => {
  const base = args.to ? resolve(args.to) : join(context.dataDir, 'backups');
  if (args.list) {
    const backups = listBackups(base);
    if (backups.length === 0) {
      context.stdout(
        `バックアップは、ありません(${base})。作るには、seiri backup`
      );
      return EXIT_CODES.ok;
    }
    context.stdout(`バックアップ(新しい順。${base}):`);
    for (const name of backups) context.stdout(`  ${name}`);
    return EXIT_CODES.ok;
  }

  const libraries = listRegisteredLibraries(context).filter(
    (library) =>
      library.state !== 'stale' &&
      (!args.library || library.root === resolve(args.library)) &&
      existsSync(ledgerPathFor(context.dataDir, library.id))
  );
  if (libraries.length === 0 && !existsSync(configPathFor(context.dataDir))) {
    throw new CliError(
      'バックアップするものが、ありません(この Mac に、台帳も設定も、ありません)。'
    );
  }

  const name = `backup-${compactTimestamp(context.now())}`;
  const destination = join(base, name);
  if (existsSync(destination)) {
    throw new CliError(
      `すでに同じ名前のバックアップがあります(1 秒待って、やり直してください): ${destination}`
    );
  }
  mkdirSync(destination, { recursive: true });

  if (existsSync(configPathFor(context.dataDir))) {
    cpSync(configPathFor(context.dataDir), join(destination, 'config.json'));
  }
  const entries: BackupEntry[] = [];
  for (const library of libraries) {
    const ledger = openLedger(ledgerPathFor(context.dataDir, library.id), {
      mode: 'readonly',
      libraryId: library.id,
    });
    try {
      const target = join(
        destination,
        'libraries',
        library.id,
        'catalog.sqlite'
      );
      const { revision } = createSnapshot(ledger, target);
      const count = (sql: string): number =>
        ledger.db.query<{ n: number }, []>(sql).get()?.n ?? 0;

      let snapshotRevision: number | null = null;
      let comparison: Comparison = 'disconnected';
      if (library.state === 'connected') {
        const snapshot = snapshotPathOf(library.root);
        if (!existsSync(snapshot)) {
          comparison = 'no-snapshot';
        } else {
          const copy = openLedger(snapshot, {
            mode: 'readonly',
            libraryId: library.id,
          });
          try {
            snapshotRevision = getRevision(copy.db);
          } finally {
            copy.close();
          }
          comparison =
            snapshotRevision === revision
              ? 'same'
              : snapshotRevision > revision
                ? 'drive-newer'
                : 'mac-newer';
        }
      }
      entries.push({
        id: library.id,
        root: library.root,
        revision,
        runs: count('SELECT count(*) AS n FROM runs'),
        files: count('SELECT count(*) AS n FROM library_files'),
        snapshotRevision,
        comparison,
      });
      if (args.withThumbs) {
        const thumbs = thumbsDirFor(context.dataDir, library.id);
        if (existsSync(thumbs)) {
          cpSync(thumbs, join(destination, 'libraries', library.id, 'thumbs'), {
            recursive: true,
          });
        }
      }
    } finally {
      ledger.close();
    }
  }
  writeFileSync(
    join(destination, 'manifest.json'),
    `${JSON.stringify(
      {
        createdAt: context.now().toISOString(),
        seiriVersion: cliPackage.version,
        withThumbs: args.withThumbs,
        libraries: entries,
      },
      null,
      2
    )}\n`
  );

  const total = sizeOf(destination);
  const attention = entries.filter(
    (entry) =>
      entry.comparison === 'drive-newer' || entry.comparison === 'mac-newer'
  );
  if (context.fancy) {
    showReport(context, {
      title: 'バックアップ',
      badge:
        attention.length > 0
          ? { label: '要確認', tone: 'warn' }
          : { label: '完了', tone: 'ok' },
      sections: [
        {
          title: destination,
          tone: 'ok',
          rows: [
            { label: '台帳', value: `${entries.length} 件` },
            { label: '大きさ', value: formatBytes(total) },
            {
              label: 'サムネイル',
              value: args.withThumbs ? '含めた' : '含めていない(--with-thumbs)',
              tone: 'dim',
            },
          ],
        },
        ...entries.map((entry) => ({
          title: `${entry.id.slice(0, 8)}  ${entry.root}`,
          tone: (entry.comparison === 'same'
            ? 'ok'
            : entry.comparison === 'disconnected'
              ? 'dim'
              : 'warn') as 'ok' | 'dim' | 'warn',
          rows: [
            {
              label: 'ファイル',
              value: `${entry.files.toLocaleString('en-US')} 件(実行 ${entry.runs} 回)`,
            },
            {
              label: 'リビジョン',
              value: `この Mac ${entry.revision} / ドライブ ${entry.snapshotRevision ?? '-'}`,
            },
            { label: '突き合わせ', value: COMPARISON_LABELS[entry.comparison] },
          ],
        })),
      ],
      hint: '大事なデータは、別のドライブにも、コピーしてください(--to <別のドライブ>)',
    });
  } else {
    context.stdout(`バックアップを作りました: ${destination}`);
    context.stdout(
      `  台帳 ${entries.length} 件 / ${formatBytes(total)}${args.withThumbs ? '(サムネイルつき)' : ''}`
    );
    for (const entry of entries) {
      context.stdout(`  ${entry.id.slice(0, 8)}  ${entry.root}`);
      context.stdout(
        `    ファイル ${entry.files} 件 / リビジョン この Mac ${entry.revision}・ドライブ ${entry.snapshotRevision ?? '-'} → ${COMPARISON_LABELS[entry.comparison]}`
      );
    }
    context.stdout(
      '大事なデータは、別のドライブにも、コピーしてください(--to <別のドライブ>)。'
    );
  }
  return EXIT_CODES.ok;
};
