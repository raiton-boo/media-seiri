import { parseArgs } from 'node:util';
import { systemTimeZone } from '@file-seiri/core';
import { CliError } from './cli-error.ts';
import { drivesCommand } from './commands/drives.ts';
import { ingestCommand } from './commands/ingest.ts';
import { libraryInit } from './commands/library-init.ts';
import { resolveDataDir } from './config/paths.ts';
import { type CommandContext, newLibraryId } from './context.ts';
import { EXIT_CODES, type ExitCode } from './exit-codes.ts';
import { askYesNo } from './prompt.ts';
import {
  listMountedVolumes,
  resolveVolume as resolveRealVolume,
  type VolumeInfo,
} from './volume/index.ts';

const USAGE = `使い方: file-seiri [--data-dir <パス>] <コマンド>

コマンド:
  library init <保存先のパス>   ライブラリを作る(目印・台帳・設定)
  drives                        接続中のドライブの一覧(名前・容量・空き・形式・種類・状態・ライブラリ)
  ingest <ソース...> --dest <ライブラリの根>
                                ソースを取り込む(--dry-run: コピーせず、結果だけ)

オプション:
  --data-dir <パス>   作業用の領域(data/)の場所。環境変数 FILE_SEIRI_DATA_DIR でも指定できる
  --dest <パス>       ingest の保存先(ライブラリの根)
  --dry-run           ingest で、コピーせずに、結果だけを見る
  --resume            ingest で、中断した実行を、続きから実行する
  -y, --yes           ingest で、コピーの前の確認を、省く
  --rehash            ingest で、ハッシュのキャッシュを使わず、計算し直す
  --restore-snapshot  ingest で、スナップショットのほうが新しいとき、置き換えてよい(確認済み)
  -h, --help          この説明を表示する`;

export type RunEnvironment = {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now?: () => Date;
  newLibraryId?: () => string;
  resolveVolume?: (path: string) => VolumeInfo;
  listVolumes?: () => VolumeInfo[];
  timeZone?: string;
  isInteractive?: boolean;
  confirm?: (question: string) => Promise<boolean>;
  shouldStop?: () => boolean;
  ingestHooks?: CommandContext['ingestHooks'];
};

/**
 * コマンドを実行して、終了コードを返す。`process.exit` は、ここでは呼ばない(テストできるように)。
 * 利用者に見せる失敗(`CliError`)は、メッセージを表示して、2 にする。それ以外の予期しない失敗は、そのまま投げる。
 */
export const run = async (
  argv: readonly string[],
  environment: RunEnvironment
): Promise<ExitCode> => {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        'data-dir': { type: 'string' },
        dest: { type: 'string' },
        'dry-run': { type: 'boolean' },
        rehash: { type: 'boolean' },
        'restore-snapshot': { type: 'boolean' },
        resume: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
    if (values.help || positionals.length === 0) {
      environment.stdout(USAGE);
      return values.help ? EXIT_CODES.ok : EXIT_CODES.failed;
    }

    const context: CommandContext = {
      stdout: environment.stdout,
      stderr: environment.stderr,
      dataDir: resolveDataDir(values['data-dir'], environment.env),
      now: environment.now ?? (() => new Date()),
      newLibraryId: environment.newLibraryId ?? newLibraryId,
      resolveVolume:
        environment.resolveVolume ?? ((path) => resolveRealVolume(path)),
      listVolumes: environment.listVolumes ?? (() => listMountedVolumes()),
      timeZone: environment.timeZone ?? systemTimeZone(),
      isInteractive:
        environment.isInteractive ??
        Boolean(process.stdin.isTTY && process.stdout.isTTY),
      confirm: environment.confirm ?? askYesNo,
      shouldStop: environment.shouldStop ?? (() => false),
      ingestHooks: environment.ingestHooks,
    };
    const [command, subcommand, ...rest] = positionals;
    if (command === 'library' && subcommand === 'init' && rest.length <= 1) {
      return libraryInit(context, rest[0]);
    }
    if (command === 'drives' && positionals.length === 1) {
      return drivesCommand(context);
    }
    if (command === 'ingest') {
      return await ingestCommand(context, {
        sources: positionals.slice(1),
        destination: values.dest,
        dryRun: values['dry-run'] ?? false,
        rehash: values.rehash ?? false,
        restoreSnapshot: values['restore-snapshot'] ?? false,
        resume: values.resume ?? false,
        yes: values.yes ?? false,
      });
    }
    throw new CliError(
      `知らないコマンドです: ${positionals.join(' ')}\n\n${USAGE}`
    );
  } catch (error) {
    if (error instanceof CliError) {
      environment.stderr(`エラー: ${error.message}`);
      return EXIT_CODES.failed;
    }
    // parseArgs の、使い方の誤り(知らないオプションなど)
    if (
      error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS')
    ) {
      environment.stderr(`エラー: ${error.message}\n\n${USAGE}`);
      return EXIT_CODES.failed;
    }
    throw error;
  }
};
