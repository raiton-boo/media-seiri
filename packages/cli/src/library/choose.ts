import { resolve } from 'node:path';
import { CliError } from '../cli-error.ts';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { readMarker } from './marker.ts';

/** `--library` の指定、または、この Mac に登録されたライブラリが 1 つだけならそれ。ライブラリの根を返す */
export const chooseLibraryRoot = (
  context: CommandContext,
  option: string | undefined
): string => {
  if (option) return resolve(option);
  const registered = Object.entries(readConfig(context.dataDir).libraries);
  const [only, ...others] = registered;
  if (!only) {
    throw new CliError(
      'この Mac に登録されたライブラリがありません。--library <ライブラリの根> で指定してください。'
    );
  }
  if (others.length > 0) {
    const list = registered
      .map(([id, entry]) => `  ${id.slice(0, 8)}  ${entry.root}`)
      .join('\n');
    throw new CliError(
      `ライブラリが複数あります。--library <ライブラリの根> で指定してください。\n${list}`
    );
  }
  return only[1].root;
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
