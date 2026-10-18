import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  compareWithSnapshot,
  type Ledger,
  openLedger,
  restoreFromSnapshot,
  snapshotPathOf,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { libraryInit } from '../commands/library-init.ts';
import { ledgerPathFor } from '../config/paths.ts';
import { readConfig, registerLibrary } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { type LibraryMarker, readMarker } from '../library/marker.ts';

export type OpenedLibrary = {
  root: string;
  libraryId: string;
  ledger: Ledger;
  snapshotPath: string;
};

export type OpenLibraryOptions = {
  /** スナップショットのほうが新しいとき、置き換えてよい(利用者が、確認済み) */
  restoreSnapshot: boolean;
  /** 目印がないとき、端末なら、ライブラリを作るか確認する(取り込みの既定)。検査などは、false(作らず、案内して止める) */
  createIfMissing?: boolean;
};

const SNAPSHOT_NEWER_HELP =
  'ライブラリのスナップショットのほうが、この Mac の台帳より新しい状態です(別の Mac で取り込んだ、または、この Mac の data/ が古い)。自動では、上書きしません。\n' +
  '置き換えるなら、--restore-snapshot を付けて、もう一度実行してください(いまの台帳は、別名で残します)。';

/** 目印がないとき、ライブラリを作らずに、止める */
const failMissingLibrary = (root: string): never => {
  throw new CliError(
    `ライブラリではありません(目印がありません): ${root}\n` +
      '`file-seiri library init <保存先のパス>` で、ライブラリを作ってください。'
  );
};

/**
 * 保存先に目印がないとき(仕様書 §9-2): 端末なら、ライブラリを作るか確認し、はいなら `library init` と同じ処理で作る。
 * 端末でなければ、案内して止める(質問できないため)。
 */
const createLibraryAfterConfirm = async (
  context: CommandContext,
  root: string
): Promise<LibraryMarker> => {
  const guide =
    '`file-seiri library init <保存先のパス>` で、ライブラリを作ってください。';
  if (!context.isInteractive) {
    throw new CliError(
      `保存先は、ライブラリではありません(目印がありません): ${root}\n${guide}`
    );
  }
  context.stdout(
    `保存先は、ライブラリではありません(目印がありません): ${root}`
  );
  if (!(await context.confirm('ここに、ライブラリを作りますか'))) {
    throw new CliError(
      `中止しました(ライブラリは、作っていません)。\n${guide}`
    );
  }
  libraryInit(context, root);
  const created = readMarker(root);
  if (!created) throw new CliError(`ライブラリを作れませんでした: ${root}`);
  return created;
};

/**
 * ライブラリを、取り込みのために開く。
 * 1. 目印(`.file-seiri-library.json`)から、ライブラリ ID を得る(なければ、作るか確認する)
 * 2. 作業用の台帳と、スナップショットのリビジョンを比べる(仕様書 §8-2)
 *    - 作業用の台帳がない(`data/` を失った)→ スナップショットから復元する(失うものがないため、確認なし)
 *    - スナップショットのほうが新しい → 端末なら質問する。そうでなければ停止する。自動では上書きしない
 * 3. 台帳を書き込み用に開く(必要なら、スキーマを移行する)
 * 4. ライブラリの場所を、設定に記録する(別のドライブにコピーして、場所が変わったときのため。仕様書 §8-4)
 */
export const openLibraryForIngest = async (
  context: CommandContext,
  destination: string,
  options: OpenLibraryOptions
): Promise<OpenedLibrary> => {
  const root = resolve(destination);
  if (!existsSync(root)) throw new CliError(`保存先がありません: ${root}`);
  const marker =
    readMarker(root) ??
    (options.createIfMissing === false
      ? failMissingLibrary(root)
      : await createLibraryAfterConfirm(context, root));
  const libraryId = marker.libraryId;
  const workingPath = ledgerPathFor(context.dataDir, libraryId);
  const snapshotPath = snapshotPathOf(root);

  const status = compareWithSnapshot({ workingPath, snapshotPath, libraryId });
  if (status.kind === 'working-missing') {
    restoreFromSnapshot({
      snapshotPath,
      workingPath,
      libraryId,
      confirmed: false,
      now: context.now(),
    });
    context.stdout(
      `この Mac の台帳がないため、スナップショットから復元しました(リビジョン ${status.snapshotRevision})。`
    );
  } else if (status.kind === 'snapshot-newer') {
    const detail = `リビジョン: スナップショット ${status.snapshotRevision}、この Mac の台帳 ${status.workingRevision}`;
    let confirmed = options.restoreSnapshot;
    if (!confirmed && context.isInteractive) {
      context.stdout(`${SNAPSHOT_NEWER_HELP.split('\n')[0]}\n${detail}`);
      confirmed = await context.confirm(
        'スナップショットで置き換えますか(いまの台帳は、別名で残します)'
      );
      if (!confirmed)
        throw new CliError('中止しました(台帳は、そのままです)。');
    }
    if (!confirmed) throw new CliError(`${SNAPSHOT_NEWER_HELP}\n${detail}`);
    const restored = restoreFromSnapshot({
      snapshotPath,
      workingPath,
      libraryId,
      confirmed: true,
      now: context.now(),
    });
    context.stdout(
      `スナップショットで置き換えました(リビジョン ${restored.restoredRevision})。前の台帳: ${restored.backupPath}`
    );
  } else if (status.kind === 'no-snapshot' && !existsSync(workingPath)) {
    context.stderr(
      '警告: この Mac に台帳がなく、スナップショットもありません。新しい台帳を作ります(ライブラリにすでにあるファイルは、台帳に載りません)。'
    );
  }

  const ledger = openLedger(workingPath, { libraryId });
  const registered = readConfig(context.dataDir).libraries[libraryId];
  if (registered?.root !== root) {
    registerLibrary(context.dataDir, libraryId, {
      root,
      registeredAt: context.now().toISOString(),
    });
    if (registered)
      context.stdout(
        `ライブラリの場所を更新しました: ${registered.root} → ${root}`
      );
  }
  return { root, libraryId, ledger, snapshotPath };
};
