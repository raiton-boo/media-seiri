import { spawn } from 'node:child_process';

export type Spawn = (command: string, args: string[]) => void;

const defaultSpawn: Spawn = (command, args) => {
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  // ブラウザが開けなくても、ビューアは動かす(アドレスは、画面に出している)
  child.on('error', () => {});
  child.unref();
};

/** OS ごとの、ブラウザで開くコマンド */
export const browserCommand = (
  platform: string,
  url: string
): { command: string; args: string[] } =>
  platform === 'win32'
    ? // `start` の最初の引数は、ウィンドウの題名(空)
      { command: 'cmd', args: ['/c', 'start', '', url] }
    : platform === 'darwin'
      ? { command: 'open', args: [url] }
      : { command: 'xdg-open', args: [url] };

/** 既定のブラウザで、アドレスを開く */
export const openBrowser = (
  url: string,
  platform: string = process.platform,
  run: Spawn = defaultSpawn
): void => {
  const { command, args } = browserCommand(platform, url);
  run(command, args);
};
