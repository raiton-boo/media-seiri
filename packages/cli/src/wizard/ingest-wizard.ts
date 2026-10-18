import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePathInput, shellQuote } from '../ask.ts';
import { libraryInit } from '../commands/library-init.ts';
import { readConfig } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES } from '../exit-codes.ts';
import { formatBytes } from '../ingest/preflight.ts';
import { markerExists } from '../library/marker.ts';
import type { VolumeInfo } from '../volume/index.ts';
import { browse, homeShortcuts } from './browse.ts';

export type WizardAnswer = {
  sources: string[];
  destination: string;
  dryRun: boolean;
};

const volumeName = (volume: VolumeInfo): string =>
  volume.label || volume.volumeUuid;

const volumeHint = (volume: VolumeInfo): string =>
  `空き ${formatBytes(volume.freeBytes)} / ${volume.fsType}`;

/** 取り込み元を、選ぶ(ドライブ・よく使う場所・パスの入力)。複数、足せる */
const chooseSources = async (context: CommandContext): Promise<string[]> => {
  const sources: string[] = [];
  for (;;) {
    const external = context
      .listVolumes()
      .filter((volume) => !volume.isInternal && existsSync(volume.mountPoint));
    const choices = [
      ...external.map((volume) => ({
        label: `${volumeName(volume)}(外付けのドライブ)`,
        hint: volumeHint(volume),
        value: volume.mountPoint as string | undefined,
      })),
      ...homeShortcuts(existsSync).map((item) => ({
        label: item.label,
        value: item.path as string | undefined,
      })),
      { label: 'パスを入力する', value: undefined },
    ];
    const start = await context.ask.select(
      sources.length === 0
        ? '写真・動画は、どこから取り込みますか?'
        : 'もう 1 つの取り込み元は、どこですか?',
      choices
    );
    const picked =
      start === undefined
        ? normalizePathInput(await context.ask.text('取り込み元のパス'))
        : await browse(context, start, '取り込み元');
    if (!existsSync(picked)) {
      context.stdout(`\n  見つかりません: ${picked}`);
      continue;
    }
    if (!sources.includes(picked)) sources.push(picked);
    const more = await context.ask.select(
      `取り込み元: ${sources.join(' / ')}`,
      [
        { label: 'これで決める', value: false },
        { label: 'ほかにも、取り込み元を足す', value: true },
      ]
    );
    if (!more) return sources;
  }
};

/** 新しいライブラリを、作る場所を選んで、作る。作った根を返す(やめたら undefined) */
const createLibrary = async (
  context: CommandContext
): Promise<string | undefined> => {
  const writable = context
    .listVolumes()
    .filter((volume) => volume.isWritable && existsSync(volume.mountPoint));
  const external = writable.filter((volume) => !volume.isInternal);
  const choices = [
    ...external.map((volume) => ({
      label: `${volumeName(volume)}(外付けのドライブ)`,
      hint: volumeHint(volume),
      value: join(volume.mountPoint, 'Pictures') as string | undefined,
    })),
    { label: 'パスを入力する', value: undefined },
  ];
  const suggested = await context.ask.select(
    '新しいライブラリは、どこに作りますか?(おすすめは、外付けのドライブ)',
    choices
  );
  const typed = await context.ask.text(
    'ライブラリの場所(この中に、整理した写真が入ります)',
    suggested
  );
  const root = normalizePathInput(typed);
  const code = libraryInit(context, root);
  return code === EXIT_CODES.ok ? root : undefined;
};

/** 保存先(ライブラリ)を、選ぶ。登録済みから選ぶか、新しく作る */
const chooseDestination = async (
  context: CommandContext
): Promise<string | undefined> => {
  const config = readConfig(context.dataDir);
  const libraries = Object.values(config.libraries).filter((entry) =>
    markerExists(entry.root)
  );
  const choices = [
    ...libraries.map((entry) => ({
      label: entry.root,
      hint: '(登録済みのライブラリ)',
      value: entry.root as string | 'new' | 'type',
    })),
    { label: '新しくライブラリを作る', value: 'new' as const },
    { label: '作ってあるライブラリを、パスで指定する', value: 'type' as const },
  ];
  const answer = await context.ask.select(
    '整理した写真は、どこ(ライブラリ)に保存しますか?',
    choices
  );
  if (answer === 'new') return createLibrary(context);
  if (answer === 'type') {
    const root = normalizePathInput(await context.ask.text('ライブラリのパス'));
    if (!markerExists(root)) {
      context.stdout(
        `\n  ライブラリではありません: ${root}\n  (先に、新しくライブラリを作ってください)`
      );
      return undefined;
    }
    return root;
  }
  return answer;
};

/** 同じことを、自分で行うときのコマンド */
export const commandLineOf = (answer: WizardAnswer): string =>
  [
    'seiri ingest',
    ...answer.sources.map(shellQuote),
    '--dest',
    shellQuote(answer.destination),
    ...(answer.dryRun ? ['--dry-run'] : []),
  ].join(' ');

/**
 * 対話式の取り込み。取り込み元・保存先を、選んで決める。
 * 最後に、「同じことを、自分で行うコマンド」を見せる(次からは、引数だけで、実行できる)。
 * やめたら、`undefined`。
 */
export const ingestWizard = async (
  context: CommandContext,
  known: { sources: string[]; destination: string | undefined }
): Promise<WizardAnswer | undefined> => {
  context.stdout('取り込む場所を、選びます(いつでも、q でやめられます)。');
  const sources =
    known.sources.length > 0 ? known.sources : await chooseSources(context);
  const destination = known.destination ?? (await chooseDestination(context));
  if (!destination) return undefined;

  const mode = await context.ask.select('どう進めますか?', [
    {
      label: 'まず、結果だけ見る(コピーしない)',
      hint: '(おすすめ。dry-run)',
      value: 'dry' as const,
    },
    {
      label: '取り込む(コピーの前に、もう一度、確認します)',
      value: 'run' as const,
    },
    { label: 'やめる', value: 'cancel' as const },
  ]);
  if (mode === 'cancel') return undefined;
  const answer: WizardAnswer = { sources, destination, dryRun: mode === 'dry' };
  context.stdout(
    `\n同じことを、自分で行うときは、こう打ちます:\n  ${commandLineOf(answer)}\n`
  );
  return answer;
};
