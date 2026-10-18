import { render } from 'ink';
import { createElement } from 'react';
import { LiveApp } from './app.tsx';
import { createFeed, type LiveFeed } from './feed.ts';
import type { PauseGate } from './progress.ts';
import { type SleepGuard, startSleepGuard } from './sleep-guard.ts';

/** 画面と取り込みの間で、共有する状態(キー操作の結果) */
export type LiveControls = {
  paused: boolean;
  /** 「安全に停止」の要求(q・Ctrl-C を 1 回) */
  stopRequested: boolean;
  /** 画面に出す、ひと言のお知らせ */
  notice: string;
};

export type LiveController = {
  feed: LiveFeed;
  /** 処理の合間に呼ぶ(一時停止中は、再開まで待つ) */
  pause: PauseGate;
  /** 「安全に停止」が、要求されたか */
  stopRequested: () => boolean;
  /** 画面を出す。すでに出ていれば、何もしない */
  start: () => void;
  /** 画面を、いったん閉じる(確認の質問のため)。閉じるまで、待つ */
  suspend: () => Promise<void>;
  /** 閉じた画面を、また出す */
  resume: () => void;
  /** 画面を閉じて、スリープの抑止を解く */
  stop: () => Promise<void>;
  /** 画面のログの欄に、ひと言を足す(取り込みが、標準出力に出していた行) */
  note: (message: string) => void;
};

/**
 * ライブ表示(btop 風)を、動かす。画面は Ink。取り込みは、`feed`(進み具合)・`pause`(一時停止)・`stopRequested`(停止の要求)だけを使う。
 * Ctrl-C は、画面が、自分で受ける(Ctrl-C を 1 回: 安全に停止、続けて 2 回: 強制終了)。
 */
export const createLiveController = (
  options: { onForceExit?: () => void; sleepGuard?: SleepGuard } = {}
): LiveController => {
  const feed = createFeed();
  const controls: LiveControls = {
    paused: false,
    stopRequested: false,
    notice: '',
  };
  const waiters: (() => void)[] = [];
  const sleepGuard = options.sleepGuard ?? startSleepGuard();
  let instance: ReturnType<typeof render> | undefined;
  const extraNotes: string[] = [];

  const setPaused = (paused: boolean): void => {
    controls.paused = paused;
    if (!paused) for (const waiter of waiters.splice(0)) waiter();
  };

  const mount = (): void => {
    instance = render(
      createElement(LiveApp, {
        feed,
        controls,
        sleepGuard: sleepGuard.active,
        setPaused,
        onForceExit: options.onForceExit ?? (() => process.exit(130)),
        notes: extraNotes,
      }),
      { exitOnCtrlC: false, maxFps: 30 }
    );
  };

  return {
    feed,
    pause: {
      isPaused: () => controls.paused,
      wait: () =>
        controls.paused
          ? new Promise<void>((resolve) => waiters.push(resolve))
          : Promise.resolve(),
    },
    stopRequested: () => controls.stopRequested,
    start: () => {
      if (!instance) mount();
    },
    suspend: async () => {
      if (!instance) return;
      instance.unmount();
      await instance.waitUntilExit();
      instance = undefined;
    },
    resume: () => {
      if (!instance) mount();
    },
    stop: async () => {
      if (instance) {
        instance.unmount();
        await instance.waitUntilExit();
        instance = undefined;
      }
      setPaused(false);
      sleepGuard.stop();
    },
    note: (message) => {
      extraNotes.push(message);
    },
  };
};
