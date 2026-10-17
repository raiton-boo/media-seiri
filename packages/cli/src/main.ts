#!/usr/bin/env bun
import { run } from './run.ts';

process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});
