import { render } from 'ink';
import type { ReactElement } from 'react';
import { type Asker, PromptCancelled } from '../ask.ts';
import { SelectPrompt, TextPrompt } from './prompts.tsx';

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

/** 画面を 1 つ出して、答えが出る(または、やめる)まで待つ。答えのあとは、画面を閉じる(1 行の記録は残る) */
const ask = <T,>(
  build: (done: (value: T) => void, cancel: () => void) => ReactElement
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const instance = render(
      build(
        (value) => {
          if (settled) return;
          settled = true;
          instance.unmount();
          void instance.waitUntilExit().then(() => resolve(value));
        },
        () => {
          if (settled) return;
          settled = true;
          instance.unmount();
          void instance
            .waitUntilExit()
            .then(() => reject(new PromptCancelled()));
        }
      ),
      { exitOnCtrlC: false }
    );
  });

/** 矢印キーで選ぶ・文字を入力する、色つきの画面(Ink)。端末でないときは、`createAsker`(番号入力)を使う */
export const createInkAsker = (): Asker => ({
  select: async (message, choices) => {
    if (choices.length === 0) throw new PromptCancelled();
    const index = await ask<number>((done, cancel) => (
      <SelectPrompt
        message={message}
        items={choices.map(({ label, hint }) => ({ label, hint }))}
        columns={process.stdout.columns ?? DEFAULT_COLUMNS}
        rows={process.stdout.rows ?? DEFAULT_ROWS}
        onDone={done}
        onCancel={cancel}
      />
    ));
    const chosen = choices[index];
    if (!chosen) throw new PromptCancelled();
    return chosen.value;
  },
  text: (message, initial) =>
    ask<string>((done, cancel) => (
      <TextPrompt
        message={message}
        initial={initial}
        columns={process.stdout.columns ?? DEFAULT_COLUMNS}
        onDone={done}
        onCancel={cancel}
      />
    )),
});
