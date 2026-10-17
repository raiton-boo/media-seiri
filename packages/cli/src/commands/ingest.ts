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
};

/** `ingest <ソース...> --dest <ライブラリの根> [--dry-run] [--rehash] [--restore-snapshot]` */
export const ingestCommand = (
  context: CommandContext,
  args: IngestArguments
): Promise<ExitCode> => {
  if (args.sources.length === 0 || !args.destination) {
    throw new CliError(
      '使い方: file-seiri ingest <ソースのフォルダ...> --dest <ライブラリの根> [--dry-run]'
    );
  }
  return runIngest(context, {
    sources: args.sources,
    destination: args.destination,
    dryRun: args.dryRun,
    rehash: args.rehash,
    restoreSnapshot: args.restoreSnapshot,
  });
};
