import { CliError } from '../cli-error.ts';
import type { CommandContext } from '../context.ts';
import type { ExitCode } from '../exit-codes.ts';
import { runIngest } from '../ingest/run-ingest.ts';

export type IngestArguments = {
  sources: string[];
  destination: string | undefined;
  dryRun: boolean;
  rehash: boolean;
  restoreSnapshot: boolean;
  resume: boolean;
  yes: boolean;
};

/** `ingest <ソース...> --dest <ライブラリの根> [--dry-run] [--resume] [--yes] [--rehash] [--restore-snapshot]` */
export const ingestCommand = (
  context: CommandContext,
  args: IngestArguments
): Promise<ExitCode> => {
  if (args.sources.length === 0 || !args.destination) {
    throw new CliError(
      '使い方: file-seiri ingest <ソースのフォルダ...> --dest <ライブラリの根> [--dry-run]'
    );
  }
  if (args.dryRun && args.resume) {
    throw new CliError(
      '--dry-run と --resume は、一緒に使えません(dry-run は、中断も、再開もしません)。'
    );
  }
  return runIngest(context, {
    sources: args.sources,
    destination: args.destination,
    dryRun: args.dryRun,
    rehash: args.rehash,
    restoreSnapshot: args.restoreSnapshot,
    resume: args.resume,
    yes: args.yes,
  });
};
