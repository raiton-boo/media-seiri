#!/usr/bin/env bun
import { run } from './run.ts';

// Ctrl-C: 1 回目は、取り込みが、今のファイルまで終えて、安全に止まる。2 回目は、強制終了する(仕様書 §13-1)
let interruptRequests = 0;
process.on('SIGINT', () => {
  interruptRequests += 1;
  if (interruptRequests >= 2) process.exit(130);
  console.error(
    '\n中断しています(今のファイルまで終えます)。もう一度 Ctrl-C を押すと、強制終了します。'
  );
});

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
  shouldStop: () => interruptRequests > 0,
});
