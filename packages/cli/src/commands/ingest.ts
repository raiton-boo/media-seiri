import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { runIngest } from '../ingest/run-ingest.ts';
import { ingestWizard } from '../wizard/ingest-wizard.ts';

export type IngestArguments = {
  sources: string[];
  destination: string | undefined;
  dryRun: boolean;
  rehash: boolean;
  restoreSnapshot: boolean;
  resume: boolean;
  yes: boolean;
  /** ライブ表示を使わない(ログの行だけ) */
  plain: boolean;
};

/** `ingest <ソース...> --dest <ライブラリの根> [--dry-run] [--resume] [--yes] [--rehash] [--restore-snapshot]` */
export const ingestCommand = async (
  context: CommandContext,
  args: IngestArguments
): Promise<ExitCode> => {
  let { sources, destination, dryRun } = args;
  if (sources.length === 0 || !destination) {
    if (!context.isInteractive) {
      throw new CliError(
        '使い方: seiri ingest <ソースのフォルダ...> --dest <ライブラリの根> [--dry-run]\n(端末で、引数なしで実行すると、選びながら進められます)'
      );
    }
    // 足りない分だけ、選んでもらう
    const answer = await ingestWizard(context, { sources, destination });
    if (!answer) {
      context.stdout('取り込みを、やめました。');
      return EXIT_CODES.ok;
    }
    sources = answer.sources;
    destination = answer.destination;
    dryRun = dryRun || answer.dryRun;
  }
  if (dryRun && args.resume) {
    throw new CliError(
      '--dry-run と --resume は、一緒に使えません(dry-run は、中断も、再開もしません)。'
    );
  }
  return runIngest(context, {
    sources,
    destination,
    dryRun,
    rehash: args.rehash,
    restoreSnapshot: args.restoreSnapshot,
    resume: args.resume,
    yes: args.yes,
    plain: args.plain,
  });
};
