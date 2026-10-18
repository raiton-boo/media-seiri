import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

/** 選択肢。`hint` は、ラベルの後ろに、薄く添える補足 */
export type Choice<T> = { label: string; hint?: string; value: T };

/** 利用者に、選んでもらう・入力してもらう口。テストでは、決まった答えを返すものに、差し替える */
export type Asker = {
  /** 番号で選ぶ。Enter だけなら、1 番 */
  select: <T>(message: string, choices: readonly Choice<T>[]) => Promise<T>;
  /** 文字を入力する。Enter だけなら、`initial` */
  text: (message: string, initial?: string) => Promise<string>;
};

/** 対話の途中で、やめた(Ctrl-C・入力の終わり・`q`) */
export class PromptCancelled extends Error {
  constructor() {
    super('中止しました');
    this.name = 'PromptCancelled';
  }
}

/** 1 行を読む。Ctrl-C・入力の終わりは、中止 */
const readLine = (prompt: string): Promise<string> =>
  new Promise((resolveLine, reject) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    let answered = false;
    readline.on('SIGINT', () => {
      readline.close();
    });
    readline.on('close', () => {
      if (!answered) reject(new PromptCancelled());
    });
    readline.question(prompt, (answer) => {
      answered = true;
      readline.close();
      resolveLine(answer);
    });
  });

/** 端末で、番号で選ぶ・文字を入力する */
export const createAsker = (print: (text: string) => void): Asker => ({
  async select(message, choices) {
    if (choices.length === 0) throw new PromptCancelled();
    for (;;) {
      print(`\n${message}`);
      choices.forEach((choice, index) => {
        const hint = choice.hint ? `  ${choice.hint}` : '';
        print(`  ${String(index + 1).padStart(2)}) ${choice.label}${hint}`);
      });
      const answer = (await readLine(`番号を入力(Enter で 1、q でやめる): `))
        .trim()
        .toLowerCase();
      if (answer === 'q') throw new PromptCancelled();
      const number = answer === '' ? 1 : Number(answer);
      const chosen = Number.isInteger(number) ? choices[number - 1] : undefined;
      if (chosen) return chosen.value;
      print('  その番号は、ありません。もう一度、選んでください。');
    }
  },
  async text(message, initial) {
    const suffix = initial ? `(Enter で ${initial})` : '';
    const answer = (await readLine(`${message}${suffix}: `)).trim();
    return answer === '' ? (initial ?? '') : answer;
  },
});

/**
 * 入力されたパスを、使える形にする。
 * ターミナルへ、フォルダをドラッグすると入る形(空白の `\ `・前後の引用符)と、`~` を、直す。
 */
export const normalizePathInput = (input: string): string => {
  let path = input.trim();
  if (
    path.length >= 2 &&
    ((path.startsWith("'") && path.endsWith("'")) ||
      (path.startsWith('"') && path.endsWith('"')))
  ) {
    path = path.slice(1, -1);
  } else {
    path = path.replace(/\\(.)/g, '$1');
  }
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
};

/** シェルに、そのまま貼れる形にする(安全な文字だけなら、そのまま) */
export const shellQuote = (text: string): string =>
  /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
