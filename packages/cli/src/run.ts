import { parseArgs } from 'node:util';
import { systemTimeZone } from '@file-seiri/core';
import { DEFAULT_WEB_DIR } from '@file-seiri/viewer';
import cliPackage from '../package.json' with { type: 'json' };
import { CliError } from './cli-error.ts';
import { drivesCommand } from './commands/drives.ts';
import { eventsCommand } from './commands/events.ts';
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
import { findCommandHelp, renderCommandHelp, renderOverview } from './help.ts';
import {
  createLiveController,
  type LiveController,
} from './live/controller.ts';
import { neverPaused, noopProgress } from './live/progress.ts';
import { askYesNo } from './prompt.ts';
import { createRepairTools, type RepairTools } from './repair/index.ts';
import { createThumbnailMaker, type ThumbnailMaker } from './thumbs/index.ts';
import {
  listMountedVolumes,
  resolveVolume as resolveRealVolume,
  type VolumeInfo,
} from './volume/index.ts';

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
  repairTools?: () => RepairTools;
  liveController?: () => LiveController;
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
        plain: { type: 'boolean' },
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
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
    });
    if (values.version) {
      environment.stdout(`seiri ${cliPackage.version}`);
      return EXIT_CODES.ok;
    }
    const color =
      environment.useColor ??
      Boolean(process.stdout.isTTY && !environment.env.NO_COLOR);
    // `seiri help <コマンド>` も、`seiri <コマンド> --help` と同じ
    const asksHelp = values.help || positionals[0] === 'help';
    if (asksHelp || positionals.length === 0) {
      const words =
        positionals[0] === 'help' ? positionals.slice(1) : positionals;
      const help = words.length > 0 ? findCommandHelp(words) : undefined;
      if (words.length > 0 && !help) {
        throw new CliError(
          `知らないコマンドです: ${words.join(' ')}\n\n${renderOverview(false)}`
        );
      }
      environment.stdout(
        help ? renderCommandHelp(help, color) : renderOverview(color)
      );
      return asksHelp ? EXIT_CODES.ok : EXIT_CODES.failed;
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
      repairTools: environment.repairTools ?? createRepairTools,
      liveController:
        environment.liveController ?? (() => createLiveController()),
      progress: noopProgress,
      pause: neverPaused,
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
    if (command === 'events' && positionals.length === 1) {
      return await eventsCommand(context, {
        library: values.library,
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
        plain: values.plain ?? false,
      });
    }
    throw new CliError(
      `知らないコマンドです: ${positionals.join(' ')}\n\n${renderOverview(false)}`
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
      environment.stderr(
        `エラー: ${error.message}\n\n${renderOverview(false)}`
      );
      return EXIT_CODES.failed;
    }
    throw error;
  }
};
