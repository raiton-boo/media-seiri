import { parseArgs } from 'node:util';
import { systemTimeZone } from '@file-seiri/core';
import { DEFAULT_WEB_DIR } from '@file-seiri/viewer';
import { CliError } from './cli-error.ts';
import { drivesCommand } from './commands/drives.ts';
import { ingestCommand } from './commands/ingest.ts';
import { libraryInit } from './commands/library-init.ts';
import { logsCommand } from './commands/logs.ts';
import { statusCommand } from './commands/status.ts';
import { thumbsCommand } from './commands/thumbs.ts';
import { verifyCommand } from './commands/verify.ts';
import { viewerCommand } from './commands/viewer.ts';
import { resolveDataDir } from './config/paths.ts';
import { type CommandContext, newLibraryId } from './context.ts';
import { EXIT_CODES, type ExitCode } from './exit-codes.ts';
import { askYesNo } from './prompt.ts';
import { createThumbnailMaker, type ThumbnailMaker } from './thumbs/index.ts';
import {
  listMountedVolumes,
  resolveVolume as resolveRealVolume,
  type VolumeInfo,
} from './volume/index.ts';

const USAGE = `使い方: file-seiri [--data-dir <パス>] <コマンド>

コマンド:
  library init <保存先のパス>   ライブラリを作る(目印・台帳・設定)
  drives                        接続中のドライブの一覧(名前・容量・空き・形式・種類・状態・ライブラリ)
  logs [--run <ID>] [--level <レベル>] [--tail <N>] [--follow]
                                実行のログを表示する(既定は、直近の実行・INFO 以上。--verbose / --quiet)
  status                        ロックの保持者と、直近の実行の状況を表示する
  verify [--library <パス>] [--sample <割合>]
                                ライブラリの全ファイルを読み直して、台帳と照合する(修復・削除はしない)
  thumbs [--library <パス>]     サムネイルのないファイルに、サムネイルを作る(何度でも実行できる)
  viewer [--library <パス>] [--port <番号>] [--snapshot]
                                ライブラリを、ブラウザで見る(閲覧専用。本機の 127.0.0.1 だけで配信する)
  ingest <ソース...> --dest <ライブラリの根>
                                ソースを取り込む(--dry-run: コピーせず、結果だけ)

オプション:
  --data-dir <パス>   作業用の領域(data/)の場所。環境変数 FILE_SEIRI_DATA_DIR でも指定できる
  --dest <パス>       ingest の保存先(ライブラリの根)
  --dry-run           ingest で、コピーせずに、結果だけを見る
  --library <パス>    verify・thumbs・logs・status の対象のライブラリの根(登録が 1 つだけなら、省ける)
  --run <ID> / --level <レベル> / --tail <N> / -f, --follow / --verbose / --quiet   logs の絞り込み・追いかけ
  --sample <割合>     verify を、抜き取りで行う(例: 0.1、10%)
  --port <番号>       viewer の待ち受けポート(既定 3939。0 なら、空いているものを選ぶ)
  --snapshot          viewer で、この Mac の台帳ではなく、ライブラリのスナップショットを開く(家の PC と同じ見え方)
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
  random?: () => number;
  useColor?: boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  thumbnailMaker?: () => ThumbnailMaker;
  viewerWebDir?: string;
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
        library: { type: 'string' },
        run: { type: 'string' },
        level: { type: 'string' },
        verbose: { type: 'boolean' },
        quiet: { type: 'boolean' },
        tail: { type: 'string' },
        follow: { type: 'boolean', short: 'f' },
        sample: { type: 'string' },
        port: { type: 'string' },
        snapshot: { type: 'boolean' },
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
      random: environment.random ?? Math.random,
      useColor:
        environment.useColor ??
        Boolean(process.stdout.isTTY && !environment.env.NO_COLOR),
      sleep:
        environment.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds))),
      thumbnailMaker: environment.thumbnailMaker ?? createThumbnailMaker,
      viewerWebDir: environment.viewerWebDir ?? DEFAULT_WEB_DIR,
      ingestHooks: environment.ingestHooks,
    };
    const [command, subcommand, ...rest] = positionals;
    if (command === 'library' && subcommand === 'init' && rest.length <= 1) {
      return libraryInit(context, rest[0]);
    }
    if (command === 'drives' && positionals.length === 1) {
      return drivesCommand(context);
    }
    if (command === 'logs' && positionals.length === 1) {
      return await logsCommand(context, {
        library: values.library,
        run: values.run,
        level: values.level,
        verbose: values.verbose ?? false,
        quiet: values.quiet ?? false,
        tail: values.tail,
        follow: values.follow ?? false,
      });
    }
    if (command === 'status' && positionals.length === 1) {
      return statusCommand(context, values.library);
    }
    if (command === 'verify' && positionals.length === 1) {
      return await verifyCommand(context, {
        library: values.library,
        sample: values.sample,
        restoreSnapshot: values['restore-snapshot'] ?? false,
      });
    }
    if (command === 'thumbs' && positionals.length === 1) {
      return await thumbsCommand(context, {
        library: values.library,
        restoreSnapshot: values['restore-snapshot'] ?? false,
      });
    }
    if (command === 'viewer' && positionals.length === 1) {
      return await viewerCommand(context, {
        library: values.library,
        port: values.port,
        snapshot: values.snapshot ?? false,
      });
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
