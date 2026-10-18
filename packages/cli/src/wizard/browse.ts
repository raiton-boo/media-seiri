import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { normalizePathInput } from '../ask.ts';
import type { CommandContext } from '../context.ts';

const PAGE_SIZE = 15;

type Entry = { name: string; kind: 'dir' | 'zip' };

/** フォルダの中の、フォルダと ZIP(隠しファイルは、除く)。読めなければ、理由を返す */
const listEntries = (
  path: string
): { entries: Entry[] } | { error: string } => {
  try {
    const entries: Entry[] = [];
    for (const item of readdirSync(path, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) entries.push({ name: item.name, kind: 'dir' });
      else if (item.isFile() && item.name.toLowerCase().endsWith('.zip'))
        entries.push({ name: item.name, kind: 'zip' });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return { entries };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

type Action =
  | { type: 'pick'; path: string }
  | { type: 'enter'; path: string }
  | { type: 'page'; page: number }
  | { type: 'type' };

/**
 * フォルダ(または ZIP)を、たどって選ぶ。「ここを選ぶ」で、いまのフォルダを返す。
 * `start` から、始める。読めない場所は、理由を出して、上へ戻る。
 */
export const browse = async (
  context: CommandContext,
  start: string,
  what: string
): Promise<string> => {
  let current = start;
  let page = 0;
  for (;;) {
    const listing = listEntries(current);
    if ('error' in listing) {
      context.stdout(`\n  読めない場所です: ${current}\n  (${listing.error})`);
      const parent = dirname(current);
      if (parent === current) {
        const typed = await context.ask.text(`${what}のパスを入力`);
        return normalizePathInput(typed);
      }
      current = parent;
      page = 0;
      continue;
    }
    const { entries } = listing;
    const visible = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const choices: { label: string; hint?: string; value: Action }[] = [
      {
        label: `ここを選ぶ → ${current}`,
        value: { type: 'pick', path: current },
      },
    ];
    if (dirname(current) !== current) {
      choices.push({
        label: '上のフォルダへ',
        hint: dirname(current),
        value: { type: 'enter', path: dirname(current) },
      });
    }
    for (const entry of visible) {
      choices.push(
        entry.kind === 'dir'
          ? {
              label: `${entry.name}/`,
              value: { type: 'enter', path: join(current, entry.name) },
            }
          : {
              label: entry.name,
              hint: '(ZIP をそのまま選ぶ)',
              value: { type: 'pick', path: join(current, entry.name) },
            }
      );
    }
    if ((page + 1) * PAGE_SIZE < entries.length) {
      choices.push({
        label: `次の ${PAGE_SIZE} 件を見る`,
        hint: `(全 ${entries.length} 件)`,
        value: { type: 'page', page: page + 1 },
      });
    }
    if (page > 0) {
      choices.push({
        label: '前の件を見る',
        value: { type: 'page', page: page - 1 },
      });
    }
    choices.push({ label: 'パスを入力する', value: { type: 'type' } });

    const action = await context.ask.select(
      `${what}を選びます。いまの場所: ${current}${entries.length === 0 ? '(中に、フォルダも ZIP もありません)' : ''}`,
      choices
    );
    if (action.type === 'pick') return action.path;
    if (action.type === 'enter') {
      current = action.path;
      page = 0;
    } else if (action.type === 'page') {
      page = action.page;
    } else {
      const typed = await context.ask.text(
        `${what}のパス(フォルダをドラッグしても入力できます)`
      );
      const path = normalizePathInput(typed);
      return path;
    }
  }
};

/** よく使う場所(あれば) */
export const homeShortcuts = (
  exists: (path: string) => boolean
): { label: string; path: string }[] => {
  const home = homedir();
  return [
    {
      label: `ピクチャ(${join(home, 'Pictures')})`,
      path: join(home, 'Pictures'),
    },
    {
      label: `デスクトップ(${join(home, 'Desktop')})`,
      path: join(home, 'Desktop'),
    },
    {
      label: `ダウンロード(${join(home, 'Downloads')})`,
      path: join(home, 'Downloads'),
    },
    { label: `ホーム(${home})`, path: home },
  ].filter((item) => exists(item.path) && basename(item.path) !== '');
};
