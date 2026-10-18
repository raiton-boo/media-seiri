#!/usr/bin/env bun
// 閲覧専用ビューアの入口(ドライブに入れて、持ち運ぶ実行ファイル。仕様書 §16-4)。取り込みなどは、含まない。
import { dirname } from 'node:path';
import { isStandalone } from './embedded/registry.ts';
import {
  defaultEnvironment,
  mainStandaloneViewer,
} from './standalone-viewer/run.ts';

// 実行ファイルでは、その置き場所から探す。開発(`bun main-viewer.ts`)では、いまのフォルダから
const startDirectory = isStandalone()
  ? dirname(process.execPath)
  : process.cwd();

process.exitCode = await mainStandaloneViewer(
  process.argv.slice(2),
  defaultEnvironment(startDirectory)
);
