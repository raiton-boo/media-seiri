import { existsSync, statfsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import {
  type Ledger,
  LedgerError,
  openLedger,
  snapshotPathOf,
} from '@file-seiri/ledger';
import {
  DEFAULT_PORT,
  type DiskUsage,
  startViewer,
  type ViewerSource,
} from '@file-seiri/viewer';
import { CliError } from '../cli-error.ts';
import { ledgerPathFor } from '../config/paths.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { chooseLibraryRoot, libraryIdOf } from '../library/choose.ts';
import { libraryThumbsDir, thumbsDirFor } from '../thumbs/index.ts';

export type ViewerArguments = {
  library: string | undefined;
  port: string | undefined;
  snapshot: boolean;
};

/** 台帳の鮮度: 台帳のファイルの更新時刻(WAL のファイルも含めて、いちばん新しいもの) */
const latestMtime = (path: string): Date => {
  const times = [path, `${path}-wal`]
    .filter((candidate) => existsSync(candidate))
    .map((candidate) => statSync(candidate).mtimeMs);
  return new Date(Math.max(...times));
};

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CliError(
      `--port は、0〜65535 の整数で指定してください: ${value}`
    );
  }
  return port;
};

const openReadOnly = (path: string, libraryId: string): Ledger => {
  try {
    return openLedger(path, { mode: 'readonly', libraryId });
  } catch (error) {
    if (error instanceof LedgerError) {
      throw new CliError(`台帳を開けません: ${error.message}`);
    }
    throw error;
  }
};

/**
 * ビューアが読むものを決める。この Mac では、作業用の台帳(最新)と `data/` のサムネイル。
 * 作業用の台帳がない(または `--snapshot`)ときは、ライブラリのスナップショットと `.file-seiri/thumbs/`
 * (家の PC と同じ見え方。ドライブが接続されている必要がある)。
 */
const openViewerSource = (
  context: CommandContext,
  args: ViewerArguments
): ViewerSource => {
  const root = chooseLibraryRoot(context, args.library);
  const libraryId = libraryIdOf(context, root);
  const workingPath = ledgerPathFor(context.dataDir, libraryId);
  const snapshotPath = snapshotPathOf(root);
  const useWorking = !args.snapshot && existsSync(workingPath);
  if (!useWorking && !existsSync(snapshotPath)) {
    throw new CliError(
      args.snapshot
        ? `スナップショットがありません(ドライブが、接続されていますか): ${snapshotPath}`
        : `見られる台帳がありません(この Mac の台帳も、ライブラリのスナップショットもありません): ${root}`
    );
  }
  const path = useWorking ? workingPath : snapshotPath;

  // ドライブの名前・種類は、この Mac で調べる(ドライブが接続されているときだけ)
  const volume = existsSync(root) ? context.resolveVolume(root) : undefined;
  const disk = (): DiskUsage | null => {
    if (!existsSync(root)) return null;
    const stats = statfsSync(root);
    return {
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize,
    };
  };
  return {
    library: {
      id: libraryId,
      name: volume?.label ?? basename(root),
      fsType: volume?.fsType ?? null,
      mediaKind: volume?.mediaKind ?? null,
    },
    source: useWorking ? 'working' : 'snapshot',
    ledger: openReadOnly(path, libraryId),
    thumbsDir: useWorking
      ? thumbsDirFor(context.dataDir, libraryId)
      : libraryThumbsDir(root),
    asOf: () => latestMtime(path),
    disk,
    now: context.now,
  };
};

/**
 * `file-seiri viewer [--library <パス>] [--port <番号>] [--snapshot]`: ライブラリを、ブラウザで見る。
 * 台帳もサムネイルも、読むだけ(閲覧専用)。本機(127.0.0.1)だけで配信し、Ctrl-C で終わる。
 * 終了コード: 0 / 2 実行できなかった(台帳がない・画面が未ビルドなど)
 */
export const viewerCommand = async (
  context: CommandContext,
  args: ViewerArguments
): Promise<ExitCode> => {
  const port = parsePort(args.port);
  if (!existsSync(context.viewerWebDir)) {
    throw new CliError(
      `画面が、まだ作られていません: ${context.viewerWebDir}\n` +
        '`bun run --filter @file-seiri/viewer build:web` で、画面を作ってください。'
    );
  }
  const source = openViewerSource(context, args);
  try {
    const running = startViewer({
      source,
      webDir: context.viewerWebDir,
      port,
    });
    context.stdout(
      `ビューアを起動しました(${source.source === 'working' ? 'この Mac の台帳' : 'スナップショット'}): ${running.url}`
    );
    context.stdout('終わるときは、Ctrl-C を押してください。');
    while (!context.shouldStop()) await context.sleep(200);
    running.stop();
    return EXIT_CODES.ok;
  } finally {
    source.ledger.close();
  }
};
