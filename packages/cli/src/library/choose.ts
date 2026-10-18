import { resolve } from 'node:path';
import { CliError } from '../cli-error.ts';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { markerExists, readMarker } from './marker.ts';

/**
 * 登録の状態:
 * - `connected`: ドライブが接続中で、目印の ID が、登録と同じ
 * - `disconnected`: ドライブが接続されていない(目印が、見えない)
 * - `stale`: 同じ場所に、別のライブラリ(別の ID)がある。同じ場所に作り直したあとの、古い登録
 */
export type LibraryState = 'connected' | 'disconnected' | 'stale';

export type RegisteredLibrary = {
  id: string;
  root: string;
  state: LibraryState;
};

const stateOf = (id: string, root: string): LibraryState => {
  if (!markerExists(root)) return 'disconnected';
  try {
    return readMarker(root)?.libraryId === id ? 'connected' : 'stale';
  } catch {
    // 目印が壊れていて読めないときは、同じものとは、言えない
    return 'disconnected';
  }
};

export const listRegisteredLibraries = (
  context: CommandContext
): RegisteredLibrary[] =>
  Object.entries(readConfig(context.dataDir).libraries).map(([id, entry]) => ({
    id,
    root: entry.root,
    state: stateOf(id, entry.root),
  }));

export const STATE_LABELS: Record<LibraryState, string> = {
  connected: '接続中',
  disconnected: 'ドライブ未接続',
  stale: '古い登録',
};

/**
 * 使うライブラリを決める。`--library` の指定があればそれ。なければ、この Mac に登録されたものから:
 * - 1 つだけ → それ
 * - 接続中のものが 1 つだけ → それ(ほかは、ドライブが外れているもの)
 * - 複数 → 端末なら、一覧から選ぶ。端末でなければ、`--library` で指定するよう、一覧つきのエラー
 * ライブラリの根を返す。
 */
export const chooseLibraryRoot = async (
  context: CommandContext,
  option: string | undefined
): Promise<string> => {
  if (option) return resolve(option);
  const all = listRegisteredLibraries(context);
  if (all.length === 0) {
    throw new CliError(
      'この Mac に登録されたライブラリがありません。--library <ライブラリの根> で指定してください(作るときは、seiri library init <保存先>)。'
    );
  }
  // 古い登録(同じ場所に、別のライブラリがある)は、選択肢に入れない
  const registered = all.filter((library) => library.state !== 'stale');
  const [only] = registered;
  if (!only) {
    throw new CliError(
      '使えるライブラリがありません(登録は、古いものだけです。seiri library prune で、古い登録を外せます)。'
    );
  }
  if (registered.length === 1) return only.root;
  const connected = registered.filter(
    (library) => library.state === 'connected'
  );
  if (connected.length === 1 && connected[0]) return connected[0].root;

  // 複数あって、決められない。選んでもらう(接続中のものが複数なら、その中から。1 つもなければ、全部から)
  const candidates = connected.length > 1 ? connected : registered;
  if (context.isInteractive) {
    return context.ask.select(
      'どのライブラリにしますか?',
      candidates.map((library) => ({
        label: library.root,
        hint: `(${library.id.slice(0, 8)}・${STATE_LABELS[library.state]})`,
        value: library.root,
      }))
    );
  }
  const list = candidates
    .map(
      (library) =>
        `  ${library.id.slice(0, 8)}  ${library.root}${library.state === 'connected' ? '' : `(${STATE_LABELS[library.state]})`}`
    )
    .join('\n');
  throw new CliError(
    `ライブラリが複数あります。--library <ライブラリの根> で指定してください(一覧は、seiri library list)。\n${list}`
  );
};

/**
 * ライブラリの根から、ライブラリ ID を得る。目印があれば、その ID。ドライブが接続されていなくても(目印が読めなくても)、
 * この Mac の設定に、その場所で登録されていれば、その ID(作業用の台帳は、この Mac にあるため、ログは、ドライブなしで見られる)。
 */
export const libraryIdOf = (context: CommandContext, root: string): string => {
  const marker = readMarker(root);
  if (marker) return marker.libraryId;
  const registered = Object.entries(readConfig(context.dataDir).libraries).find(
    ([, entry]) => entry.root === root
  );
  if (registered) return registered[0];
  throw new CliError(
    `ライブラリの ID が分かりません(目印がなく、この Mac にも登録されていません): ${root}`
  );
};
