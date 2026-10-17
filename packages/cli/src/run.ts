import { parseArgs } from 'node:util';
import { CliError } from './cli-error.ts';
import { libraryInit } from './commands/library-init.ts';
import { resolveDataDir } from './config/paths.ts';
import { type CommandContext, newLibraryId } from './context.ts';
import { EXIT_CODES, type ExitCode } from './exit-codes.ts';

const USAGE = `使い方: file-seiri [--data-dir <パス>] <コマンド>

コマンド:
  library init <保存先のパス>   ライブラリを作る(目印・台帳・設定)

オプション:
  --data-dir <パス>   作業用の領域(data/)の場所。環境変数 FILE_SEIRI_DATA_DIR でも指定できる
  -h, --help          この説明を表示する`;

export type RunEnvironment = {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now?: () => Date;
  newLibraryId?: () => string;
};

/**
 * コマンドを実行して、終了コードを返す。`process.exit` は、ここでは呼ばない(テストできるように)。
 * 利用者に見せる失敗(`CliError`)は、メッセージを表示して、2 にする。それ以外の予期しない失敗は、そのまま投げる。
 */
export const run = (
  argv: readonly string[],
  environment: RunEnvironment
): ExitCode => {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        'data-dir': { type: 'string' },
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
    };
    const [command, subcommand, ...rest] = positionals;
    if (command === 'library' && subcommand === 'init' && rest.length <= 1) {
      return libraryInit(context, rest[0]);
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
