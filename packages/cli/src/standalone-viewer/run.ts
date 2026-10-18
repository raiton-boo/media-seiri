import { existsSync, statfsSync, statSync } from 'node:fs';
import { basename, parse } from 'node:path';
import { parseArgs } from 'node:util';
import { type Ledger, openLedger, snapshotPathOf } from '@file-seiri/ledger';
import {
  DEFAULT_PORT,
  DEFAULT_WEB_DIR,
  type DiskUsage,
  startViewer,
  type ViewerSource,
} from '@file-seiri/viewer';
import { type Asker, createAsker, PromptCancelled } from '../ask.ts';
import { CliError } from '../cli-error.ts';
import { readMarker } from '../library/marker.ts';
import { libraryThumbsDir } from '../thumbs/sync.ts';
import { type LocatedLibrary, locateLibraries } from './locate.ts';
import { openBrowser } from './open-browser.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** これより古いスナップショットには、注意を添える(日数) */
const STALE_DAYS = 30;

const USAGE = `seiri-viewer — 取り込んだ写真を、ブラウザで見る(閲覧専用)

使い方: seiri-viewer [--library <パス>] [--port <番号>] [--no-open]

  --library <パス>  ライブラリの場所。省くと、この実行ファイルの置き場所から、自動で探します
  --port <番号>     待ち受けるポート(既定 ${DEFAULT_PORT}。使用中なら、空いているものを選びます)
  --no-open         ブラウザを、自動で開かない
  -h, --help        この説明を表示する

ドライブの viewer/ に置いたまま、開いてください。終わるときは、このウィンドウを閉じます(Ctrl-C でも)。`;

export type StandaloneEnvironment = {
  /** 実行ファイルの置き場所(ライブラリを探す、はじまり) */
  startDirectory: string;
  print: (text: string) => void;
  /** 複数のライブラリが見つかったとき、選んでもらう */
  ask: Asker;
  open: (url: string) => void;
  /** 終わりの合図を待つ(既定: Ctrl-C)。テストでは、すぐ返す */
  waitForStop: () => Promise<void>;
  now: () => Date;
  platform: string;
  /** 画面の静的ファイルの場所(実行ファイルでは、埋め込みを使うので、使われない) */
  webDir: string;
};

export const defaultEnvironment = (
  startDirectory: string
): StandaloneEnvironment => ({
  startDirectory,
  print: (text) => console.log(text),
  ask: createAsker((text) => console.log(text)),
  open: (url) => openBrowser(url),
  waitForStop: () =>
    new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    }),
  now: () => new Date(),
  platform: process.platform,
  webDir: DEFAULT_WEB_DIR,
});

const chooseLibrary = async (
  environment: StandaloneEnvironment,
  explicit: string | undefined
): Promise<LocatedLibrary> => {
  if (explicit) return { root: explicit, snapshotAt: undefined };
  const found = locateLibraries(environment.startDirectory);
  if (found.length === 0) {
    throw new CliError(
      `ライブラリが見つかりません(探した場所: ${environment.startDirectory})。\n` +
        'この実行ファイルを、ライブラリのドライブ(または、ライブラリの中)の viewer フォルダに置くか、\n' +
        '--library <パス> で、ライブラリの場所を指定してください。'
    );
  }
  if (found.length === 1 && found[0]) return found[0];
  return environment.ask.select(
    '見つかったライブラリが複数あります。どれを見ますか?',
    found.map((library) => ({
      label: library.root,
      hint: library.snapshotAt
        ? `(最終の更新 ${library.snapshotAt.toISOString().slice(0, 10)})`
        : '(スナップショットなし)',
      value: library,
    }))
  );
};

/** ドライブの名前が分からない環境でも、どのライブラリかが、分かる呼び名(例: `Pictures (E:\)`) */
const libraryName = (root: string, platform: string): string => {
  const name = basename(root) || root;
  const drive = parse(root).root;
  return platform === 'win32' && drive && drive !== root
    ? `${name} (${drive})`
    : name;
};

const openSnapshot = (root: string, libraryId: string): Ledger => {
  const path = snapshotPathOf(root);
  if (!existsSync(path)) {
    throw new CliError(
      `スナップショットがありません: ${path}\n` +
        '(まだ取り込んでいない、または、取り込みの途中で止まった可能性があります。Mac で取り込みを終えてから、開いてください)'
    );
  }
  return openLedger(path, { mode: 'readonly', libraryId });
};

/**
 * 閲覧専用ビューア(ドライブに入れて、持ち運ぶ実行ファイル)。ライブラリのスナップショットとサムネイルだけを読む。
 * この Mac の `data/`・ドライブ情報の取得(macOS の `diskutil` など)は、使わない(Windows でも動くように)。
 * 終わりの合図(Ctrl-C・ウィンドウを閉じる)まで、動かし続ける。終了コードを返す。
 */
export const runStandaloneViewer = async (
  argv: readonly string[],
  environment: StandaloneEnvironment
): Promise<number> => {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      library: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    environment.print(USAGE);
    return 0;
  }
  const requestedPort =
    values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65535
  ) {
    throw new CliError(
      `--port は、0〜65535 の整数で指定してください: ${values.port}`
    );
  }

  const library = await chooseLibrary(environment, values.library);
  const marker = readMarker(library.root);
  if (!marker) {
    throw new CliError(
      `ライブラリではありません(目印がありません): ${library.root}`
    );
  }
  const ledger = openSnapshot(library.root, marker.libraryId);
  try {
    const snapshotPath = snapshotPathOf(library.root);
    const snapshotAt = statSync(snapshotPath).mtime;
    const disk = (): DiskUsage | null => {
      try {
        const stats = statfsSync(library.root);
        return {
          totalBytes: stats.blocks * stats.bsize,
          freeBytes: stats.bavail * stats.bsize,
        };
      } catch {
        // 取得できない環境(権限・未対応)では、容量を出さない
        return null;
      }
    };
    const source: ViewerSource = {
      library: {
        id: marker.libraryId,
        name: libraryName(library.root, environment.platform),
        fsType: null,
        mediaKind: null,
      },
      source: 'snapshot',
      ledger,
      libraryRoot: library.root,
      thumbsDir: libraryThumbsDir(library.root),
      asOf: () => snapshotAt,
      disk,
      now: environment.now,
    };

    // 既定のポートが使用中(別のビューアが、動いている)なら、空いているものを選ぶ
    const start = (port: number) =>
      startViewer({ source, webDir: environment.webDir, port });
    let running: ReturnType<typeof startViewer>;
    try {
      running = start(requestedPort);
    } catch (error) {
      if (requestedPort === 0) throw error;
      running = start(0);
    }

    const ageDays = Math.floor(
      (environment.now().getTime() - snapshotAt.getTime()) / MS_PER_DAY
    );
    environment.print(`ビューアを起動しました: ${running.url}`);
    environment.print(`  ライブラリ: ${library.root}`);
    environment.print(
      `  最後の更新: ${snapshotAt.toISOString().slice(0, 10)}(${ageDays} 日前)`
    );
    if (ageDays >= STALE_DAYS) {
      environment.print(
        '  ※ 古い内容です。新しい取り込みは、Mac で行い、ドライブをつなぎ直してください。'
      );
    }
    environment.print(
      '終わるときは、このウィンドウを閉じてください(Ctrl-C でも)。'
    );
    if (!values['no-open']) environment.open(running.url);
    await environment.waitForStop();
    running.stop();
    return 0;
  } finally {
    ledger.close();
  }
};

/** 実行ファイルの入口。失敗は、メッセージを出して、ウィンドウがすぐ閉じないよう、待つ(ダブルクリックで開いたとき、読めるように) */
export const mainStandaloneViewer = async (
  argv: readonly string[],
  environment: StandaloneEnvironment
): Promise<number> => {
  try {
    return await runStandaloneViewer(argv, environment);
  } catch (error) {
    if (error instanceof PromptCancelled) return 130;
    const message =
      error instanceof CliError || error instanceof Error
        ? error.message
        : String(error);
    environment.print(`エラー: ${message}`);
    if (process.stdin.isTTY) {
      environment.print('\nEnter キーを押すと、閉じます。');
      await new Promise<void>((resolve) => {
        process.stdin.once('data', () => resolve());
      });
    }
    return 2;
  }
};
