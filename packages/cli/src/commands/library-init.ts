import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  LATEST_SCHEMA_VERSION,
  openLedger,
  SNAPSHOT_DIRECTORY,
} from '@file-seiri/ledger';
import { CliError } from '../cli-error.ts';
import { ledgerPathFor, libraryWorkDir } from '../config/paths.ts';
import {
  readConfig,
  registerLibrary,
  unregisterLibraries,
} from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import {
  markerExists,
  markerPathOf,
  readMarker,
  writeMarker,
} from '../library/marker.ts';
import { showReport } from '../present/index.ts';

/** `a` が、`b` と同じ場所か、`b` の中か */
const isSameOrInside = (a: string, b: string): boolean => {
  const path = relative(b, a);
  return (
    path === '' ||
    (!path.startsWith('..') && !path.startsWith(sep) && path !== '..')
  );
};

/**
 * `library init <パス>`: ライブラリの根に目印を作り、作業用の台帳を初期化して、場所を設定に記録する。
 * 空のドライブから始める前提(既存の写真の登録は、スコープ外)。
 * 途中で失敗したら、この実行で作ったものを、すべて取り消す。
 */
export const libraryInit = (
  context: CommandContext,
  rawPath: string | undefined
): ExitCode => {
  if (!rawPath) {
    throw new CliError('使い方: file-seiri library init <保存先のパス>');
  }
  const root = resolve(rawPath);

  // 出力先を再スキャンしたり、作業用の領域を、ライブラリにしたりしないため
  if (
    isSameOrInside(root, context.dataDir) ||
    isSameOrInside(context.dataDir, root)
  ) {
    throw new CliError(
      `作業用の領域(${context.dataDir})と、重なる場所は、ライブラリにできません: ${root}`
    );
  }
  if (existsSync(root) && !statSync(root).isDirectory()) {
    throw new CliError(`フォルダではありません: ${root}`);
  }
  if (markerExists(root)) {
    const existing = readMarker(root);
    throw new CliError(
      `すでにライブラリです(ID: ${existing?.libraryId}): ${root}`
    );
  }

  const libraryId = context.newLibraryId();
  const createdRoot = !existsSync(root);
  const workDir = libraryWorkDir(context.dataDir, libraryId);
  let markerWritten = false;
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(resolve(root, SNAPSHOT_DIRECTORY), { recursive: true });
    openLedger(ledgerPathFor(context.dataDir, libraryId), {
      libraryId,
    }).close();
    // 目印は、最後に作る(目印がある = ライブラリとして、使える状態)
    writeMarker(root, {
      libraryId,
      createdAt: context.now().toISOString(),
      schemaVersion: LATEST_SCHEMA_VERSION,
    });
    markerWritten = true;
    registerLibrary(context.dataDir, libraryId, {
      root,
      registeredAt: context.now().toISOString(),
    });
  } catch (error) {
    if (markerWritten) rmSync(markerPathOf(root), { force: true });
    rmSync(workDir, { recursive: true, force: true });
    rmSync(resolve(root, SNAPSHOT_DIRECTORY), { recursive: true, force: true });
    if (createdRoot) rmSync(root, { recursive: true, force: true });
    throw error;
  }

  // 同じ場所に、作り直したときは、前の登録(別の ID)は、もう使えないので、外す(この Mac の台帳は、残す)
  unregisterLibraries(
    context.dataDir,
    Object.entries(readConfig(context.dataDir).libraries)
      .filter(([id, entry]) => id !== libraryId && entry.root === root)
      .map(([id]) => id)
  );
  if (context.fancy) {
    showReport(context, {
      title: 'ライブラリを作りました',
      badge: { label: '完了', tone: 'ok' },
      sections: [
        {
          title: 'ライブラリ',
          tone: 'ok',
          rows: [
            { label: '場所', value: root },
            { label: 'ID', value: libraryId },
            { label: '台帳', value: ledgerPathFor(context.dataDir, libraryId) },
          ],
        },
      ],
      hint: 'つぎは、seiri ingest で、写真を取り込みます',
    });
    return EXIT_CODES.ok;
  }
  context.stdout(`ライブラリを作りました: ${root}`);
  context.stdout(`  ID: ${libraryId}`);
  context.stdout(`  台帳: ${ledgerPathFor(context.dataDir, libraryId)}`);
  return EXIT_CODES.ok;
};
