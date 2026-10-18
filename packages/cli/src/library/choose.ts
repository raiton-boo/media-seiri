import { resolve } from 'node:path';
import { CliError } from '../cli-error.ts';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { markerExists, readMarker } from './marker.ts';

/** この Mac に登録されたライブラリと、ドライブが接続中か(目印があるか) */
export type RegisteredLibrary = {
  id: string;
  root: string;
  connected: boolean;
};

export const listRegisteredLibraries = (
  context: CommandContext
): RegisteredLibrary[] =>
  Object.entries(readConfig(context.dataDir).libraries).map(([id, entry]) => ({
    id,
    root: entry.root,
    connected: markerExists(entry.root),
  }));

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
  const registered = listRegisteredLibraries(context);
  const [only] = registered;
  if (!only) {
    throw new CliError(
      'この Mac に登録されたライブラリがありません。--library <ライブラリの根> で指定してください(作るときは、seiri library init <保存先>)。'
    );
  }
  if (registered.length === 1) return only.root;
  const connected = registered.filter((library) => library.connected);
  if (connected.length === 1 && connected[0]) return connected[0].root;

  // 複数あって、決められない。選んでもらう(接続中のものが複数なら、その中から。1 つもなければ、全部から)
  const candidates = connected.length > 1 ? connected : registered;
  if (context.isInteractive) {
    return context.ask.select(
      'どのライブラリにしますか?',
      candidates.map((library) => ({
        label: library.root,
        hint: `(${library.id.slice(0, 8)}・${library.connected ? '接続中' : 'ドライブ未接続'})`,
        value: library.root,
      }))
    );
  }
  const list = candidates
    .map(
      (library) =>
        `  ${library.id.slice(0, 8)}  ${library.root}${library.connected ? '' : '(ドライブ未接続)'}`
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
