/** スリープの抑止(状態を、画面に出す) */
export type SleepGuard = { active: boolean; stop: () => void };

/**
 * 取り込み中に、Mac がスリープしないようにする(全件で約 55 分かかるため)。
 * `caffeinate -i -w <このプロセス>`: このプロセスが終われば、自動で解除される。macOS 以外・コマンドがない場合は、起動できず、`active: false`。
 */
export const startSleepGuard = (
  platform: string = process.platform,
  spawn: typeof Bun.spawn = Bun.spawn
): SleepGuard => {
  if (platform !== 'darwin') return { active: false, stop: () => {} };
  try {
    const child = spawn(['caffeinate', '-i', '-w', String(process.pid)], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return { active: true, stop: () => child.kill() };
  } catch {
    return { active: false, stop: () => {} };
  }
};
