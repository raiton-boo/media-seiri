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
  embeddedWeb,
  type RunningViewer,
  startViewer,
  type ViewerSource,
} from '@file-seiri/viewer';
import { CliError } from '../cli-error.ts';
import { ledgerPathFor } from '../config/paths.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { describeLedgerOpenError } from '../ledger-error.ts';
import { chooseLibraryRoot, libraryIdOf } from '../library/choose.ts';
import { showReport } from '../present/index.ts';
import { libraryThumbsDir, thumbsDirFor } from '../thumbs/index.ts';

/** 接続中のドライブの一覧を、覚えておく時間(ミリ秒) */
const MOUNT_CACHE_MS = 10_000;

export type ViewerArguments = {
  library: string | undefined;
  port: string | undefined;
  snapshot: boolean;
  /** ブラウザを、自動で開かない */
  noOpen: boolean;
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
      throw new CliError(`台帳を開けません: ${describeLedgerOpenError(error)}`);
    }
    throw error;
  }
};

/**
 * ビューアが読むものを決める。この Mac では、作業用の台帳(最新)と `data/` のサムネイル。
 * 作業用の台帳がない(または `--snapshot`)ときは、ライブラリのスナップショットと `.file-seiri/thumbs/`
 * (家の PC と同じ見え方。ドライブが接続されている必要がある)。
 */
const openViewerSource = async (
  context: CommandContext,
  args: ViewerArguments
): Promise<ViewerSource> => {
  const root = await chooseLibraryRoot(context, args.library);
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
  // ソース側のコピーを探すための、接続中のドライブの根。ドライブの一覧は、調べるのに少し時間がかかるので、短く覚えておく
  let mounted: { at: number; roots: ReadonlyMap<string, string> } | undefined;
  const mountedRoots = (): ReadonlyMap<string, string> => {
    const nowMs = context.now().getTime();
    if (!mounted || nowMs - mounted.at > MOUNT_CACHE_MS) {
      mounted = {
        at: nowMs,
        roots: new Map(
          context
            .listVolumes()
            .map((item) => [item.volumeUuid, item.rootPath] as const)
        ),
      };
    }
    return mounted.roots;
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
    libraryRoot: root,
    thumbsDir: useWorking
      ? thumbsDirFor(context.dataDir, libraryId)
      : libraryThumbsDir(root),
    asOf: () => latestMtime(path),
    disk,
    mountedRoots,
    now: context.now,
  };
};

/** ポートが使用中のエラーか(Bun.serve は、`EADDRINUSE` か、「in use」を含む文で、知らせる) */
const isAddressInUse = (error: unknown): boolean =>
  error instanceof Error &&
  (('code' in error && error.code === 'EADDRINUSE') ||
    /in use|EADDRINUSE/i.test(error.message));

/** そのポートで、ビューアが動いているか(`/api/info` に答えれば、ビューア。ライブラリの ID を返す) */
const probeViewer = async (
  port: number
): Promise<{ libraryId: string } | undefined> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/info`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { library?: { id?: unknown } };
    return typeof body.library?.id === 'string'
      ? { libraryId: body.library.id }
      : undefined;
  } catch {
    // つながらない・ビューアではない: 「ビューアではない」として扱う
    return undefined;
  }
};

type Launched =
  | { kind: 'started'; running: RunningViewer }
  | { kind: 'reused'; url: string };

/**
 * ビューアを起動する。ポートが使用中のときは:
 * - 同じライブラリのビューアが動いている → 起動せず、そのアドレスを返す(二重に起動しない)
 * - 別のライブラリのビューア、または、別のプログラム → `--port` の指定がなければ、空いているポートで起動する。指定があれば、わかる言葉で、止まる
 */
const launchViewer = async (
  context: CommandContext,
  source: ViewerSource,
  args: ViewerArguments,
  port: number
): Promise<Launched> => {
  const start = (target: number): RunningViewer =>
    startViewer({ source, webDir: context.viewerWebDir, port: target });
  try {
    return { kind: 'started', running: start(port) };
  } catch (error) {
    if (!isAddressInUse(error) || port === 0) throw error;
    const existing = await probeViewer(port);
    if (existing?.libraryId === source.library.id) {
      return { kind: 'reused', url: `http://127.0.0.1:${port}/` };
    }
    if (args.port !== undefined) {
      throw new CliError(
        existing
          ? `ポート ${port} では、別のライブラリのビューアが動いています。別のポートを指定してください(--port 0 で、空いているものを自動で選びます)。`
          : `ポート ${port} は、ほかのプログラムが使っています。別のポートを指定してください(--port 0 で、空いているものを自動で選びます)。`
      );
    }
    context.stdout(
      existing
        ? `ポート ${port} では、別のライブラリのビューアが動いているため、空いているポートで起動します。`
        : `ポート ${port} は、ほかのプログラムが使っているため、空いているポートで起動します。`
    );
    return { kind: 'started', running: start(0) };
  }
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
  if (!embeddedWeb() && !existsSync(context.viewerWebDir)) {
    throw new CliError(
      `画面が、まだ作られていません: ${context.viewerWebDir}\n` +
        '`bun run --filter @file-seiri/viewer build:web` で、画面を作ってください。'
    );
  }
  const source = await openViewerSource(context, args);
  try {
    const launched = await launchViewer(context, source, args, port);
    if (launched.kind === 'reused') {
      // すでに同じものが動いている: 新しく起動せず、そのアドレスを、開く
      context.stdout(`すでに起動しています(同じライブラリ): ${launched.url}`);
      context.stdout(
        'そのまま、ブラウザで開けます(終わらせるには、動いているほうの Ctrl-C)。'
      );
      if (!args.noOpen && context.isInteractive)
        context.openBrowser(launched.url);
      return EXIT_CODES.ok;
    }
    const running = launched.running;
    if (context.fancy) {
      showReport(context, {
        title: 'ビューア',
        badge: { label: '起動中', tone: 'ok' },
        sections: [
          {
            title: 'ブラウザで開く',
            tone: 'ok',
            rows: [
              { label: 'アドレス', value: running.url, tone: 'info' },
              {
                label: '見ているもの',
                value:
                  source.source === 'working'
                    ? 'この Mac の台帳'
                    : 'スナップショット',
              },
              {
                label: '公開範囲',
                value: 'この Mac の 127.0.0.1 だけ(閲覧専用)',
              },
            ],
          },
        ],
        hint: '終わるときは、Ctrl-C を押してください',
      });
    } else {
      context.stdout(
        `ビューアを起動しました(${source.source === 'working' ? 'この Mac の台帳' : 'スナップショット'}): ${running.url}`
      );
      context.stdout('終わるときは、Ctrl-C を押してください。');
    }
    // 端末で動かしているときは、既定のブラウザで、自動で開く(--no-open で、開かない)
    if (!args.noOpen && context.isInteractive) context.openBrowser(running.url);
    while (!context.shouldStop()) await context.sleep(200);
    running.stop();
    return EXIT_CODES.ok;
  } finally {
    source.ledger.close();
  }
};
