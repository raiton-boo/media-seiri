import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getRevision,
  INGEST_LOCK_NAME,
  isLockStale,
  type Ledger,
  openLedger,
  readLock,
  snapshotPathOf,
} from '@file-seiri/ledger';
import { ledgerPathFor, libraryWorkDir } from '../config/paths.ts';
import { unregisterLibraries } from '../config/registry.ts';
import type { CommandContext } from '../context.ts';
import {
  cleanupAppleDouble,
  cleanupPartFiles,
  listAppleDoubleFiles,
  listPartFiles,
  usesAppleDouble,
} from '../copy/index.ts';
import { formatBytes } from '../ingest/preflight.ts';
import {
  listRegisteredLibraries,
  type RegisteredLibrary,
} from '../library/choose.ts';
import { markerExists } from '../library/marker.ts';
import { isEmptyLibrary } from '../library/remove.ts';
import { thumbsDirFor } from '../thumbs/index.ts';
import type { Finding } from './types.ts';

/** 空き容量が、これを下回ったら、注意(割合) */
const LOW_FREE_RATIO = 0.05;
const GIB = 1024 ** 3;
const LOW_FREE_BYTES = 5 * GIB;
/** 一覧に出す、ファイルの最大の数 */
const SHOWN = 5;

const short = (id: string): string => id.slice(0, 8);

const sample = (paths: readonly string[]): string =>
  `${paths.slice(0, SHOWN).join('\n')}${paths.length > SHOWN ? `\nほか ${paths.length - SHOWN} 件` : ''}`;

/** フォルダの大きさ(読めないものは、数えない) */
const directorySize = (directory: string): number => {
  let total = 0;
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      total += entry.isDirectory() ? directorySize(path) : statSync(path).size;
    }
  } catch {
    // 読めない所は、数えない(診断を止めない)
  }
  return total;
};

/** 登録(この Mac の設定)の診断 */
const checkRegistrations = (
  context: CommandContext,
  libraries: RegisteredLibrary[]
): Finding[] => {
  const findings: Finding[] = [];
  if (libraries.length === 0) {
    findings.push({
      level: 'info',
      area: '登録',
      title: 'この Mac に登録されたライブラリは、ありません',
      hint: 'ライブラリを作るには、seiri library init <保存先>',
    });
    return findings;
  }
  const stale = libraries.filter((library) => library.state === 'stale');
  if (stale.length > 0) {
    findings.push({
      level: 'warn',
      area: '登録',
      title: `古い登録が ${stale.length} 件あります`,
      detail: stale
        .map((library) => `${short(library.id)}  ${library.root}`)
        .join('\n'),
      hint: '同じ場所に、作り直したライブラリがあります。seiri library prune でも外せます(ファイルは、消しません)',
      fix: {
        label: `古い登録 ${stale.length} 件を、設定から外す`,
        run: () => {
          const removed = unregisterLibraries(
            context.dataDir,
            stale.map((library) => library.id)
          );
          return `古い登録 ${removed.length} 件を、設定から外しました`;
        },
      },
    });
  } else {
    findings.push({
      level: 'ok',
      area: '登録',
      title: `登録は、正常です(${libraries.length} 件)`,
    });
  }
  const offline = libraries.filter(
    (library) => library.state === 'disconnected'
  );
  if (offline.length > 0) {
    findings.push({
      level: 'info',
      area: '登録',
      title: `ドライブが接続されていないライブラリが ${offline.length} 件あります`,
      detail: offline
        .map((library) => `${short(library.id)}  ${library.root}`)
        .join('\n'),
      hint: 'ドライブをつなぐと、使えます。間違えて作ったものなら、seiri library forget <ID> で、設定から外せます',
    });
  }
  return findings;
};

/** 接続中のドライブの診断: 未登録のライブラリ・空のライブラリ(間違えて作った目印) */
const checkDrives = (
  context: CommandContext,
  libraries: RegisteredLibrary[]
): Finding[] => {
  const findings: Finding[] = [];
  const registeredRoots = new Set(libraries.map((library) => library.root));
  const empties: string[] = [];
  const unregistered: string[] = [];
  const seen = new Set<string>();
  const consider = (root: string): void => {
    if (seen.has(root) || !markerExists(root)) return;
    seen.add(root);
    if (isEmptyLibrary(root)) empties.push(root);
    if (!registeredRoots.has(root)) unregistered.push(root);
  };
  for (const library of libraries)
    if (library.state !== 'disconnected') consider(library.root);
  for (const volume of context.listVolumes()) {
    if (volume.isInternal || !existsSync(volume.mountPoint)) continue;
    consider(volume.mountPoint);
    try {
      for (const entry of readdirSync(volume.mountPoint, {
        withFileTypes: true,
      })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          consider(join(volume.mountPoint, entry.name));
        }
      }
    } catch {
      // 読めないドライブ(権限・抜けた)は、飛ばす
    }
  }
  if (empties.length > 0) {
    findings.push({
      level: 'warn',
      area: 'ドライブ',
      title: `中身のないライブラリ(目印だけ)が ${empties.length} 件あります`,
      detail: empties.join('\n'),
      hint: '間違えて作った目印かもしれません。不要なら、seiri library remove <場所> で、目印と登録を片づけられます(写真は、入っていません)',
    });
  }
  if (unregistered.length > 0) {
    findings.push({
      level: 'info',
      area: 'ドライブ',
      title: `この Mac に未登録のライブラリが ${unregistered.length} 件あります`,
      detail: unregistered.join('\n'),
      hint: '別の Mac で作った、または、この Mac の設定が消えたものです。見るだけなら、seiri viewer --library <場所> --snapshot',
    });
  }
  if (empties.length === 0 && unregistered.length === 0) {
    findings.push({
      level: 'ok',
      area: 'ドライブ',
      title: 'ドライブの目印は、正常です',
    });
  }
  return findings;
};

/** この Mac の `data/libraries/` の中の、登録のない作業用フォルダ */
const checkOrphans = (
  context: CommandContext,
  libraries: RegisteredLibrary[]
): Finding[] => {
  const base = join(context.dataDir, 'libraries');
  if (!existsSync(base)) return [];
  const known = new Set(libraries.map((library) => library.id));
  const orphans = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !known.has(entry.name))
    .map((entry) => entry.name);
  if (orphans.length === 0) return [];
  return [
    {
      level: 'info',
      area: 'この Mac',
      title: `登録のない作業用フォルダが ${orphans.length} 件あります`,
      detail: orphans
        .map(
          (id) =>
            `${short(id)}  ${formatBytes(directorySize(libraryWorkDir(context.dataDir, id)))}  ${libraryWorkDir(context.dataDir, id)}`
        )
        .join('\n'),
      hint: '外したライブラリの台帳です。不要なら、フォルダごと削除できます(seiri は、勝手には消しません)',
    },
  ];
};

const openWorking = (
  context: CommandContext,
  library: RegisteredLibrary
): Ledger | undefined => {
  const path = ledgerPathFor(context.dataDir, library.id);
  if (!existsSync(path)) return undefined;
  return openLedger(path, { mode: 'readonly', libraryId: library.id });
};

/** ライブラリ 1 つの診断 */
const checkLibrary = (
  context: CommandContext,
  library: RegisteredLibrary
): Finding[] => {
  const area = `ライブラリ ${short(library.id)}`;
  const findings: Finding[] = [];
  const connected = library.state === 'connected';

  // この Mac の台帳
  let working: Ledger | undefined;
  try {
    working = openWorking(context, library);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outdated = message.includes('スキーマ');
    findings.push({
      level: outdated ? 'warn' : 'error',
      area,
      title: outdated
        ? 'この Mac の台帳は、古い版です'
        : 'この Mac の台帳を開けません',
      detail: message,
      hint: outdated
        ? '取り込みなどの、書き込みのある実行で、自動で新しい版に移行されます。使わない登録なら、seiri library forget <ID> で外せます'
        : 'ドライブにスナップショットがあれば、そこから復元できます(取り込みなどの実行時に、確認が出ます)',
    });
  }
  try {
    if (working) {
      const check = working.db
        .query<{ quick_check: string }, []>('PRAGMA quick_check')
        .all();
      if (check.length === 1 && check[0]?.quick_check === 'ok') {
        findings.push({ level: 'ok', area, title: '台帳の整合は、正常です' });
      } else {
        findings.push({
          level: 'error',
          area,
          title: '台帳の整合に、問題があります',
          detail: check
            .map((row) => row.quick_check)
            .slice(0, SHOWN)
            .join('\n'),
          hint: 'ドライブのスナップショットから、復元してください(seiri verify で、ファイルの照合もできます)',
        });
      }
      // ロック・実行中のままの実行
      const lock = readLock(working.db, INGEST_LOCK_NAME);
      const running =
        working.db
          .query<{ n: number }, []>(
            "SELECT count(*) AS n FROM runs WHERE status = 'running'"
          )
          .get()?.n ?? 0;
      if (lock && isLockStale(lock.heartbeatAt, context.now())) {
        findings.push({
          level: 'warn',
          area,
          title: '書き込みのロックが、途絶えたままです(異常終了した可能性)',
          detail: `保持者 ${lock.holder}`,
          hint: '次の取り込みなどが、自動で引き継ぎます。何もしなくて大丈夫です',
        });
      } else if (lock) {
        findings.push({
          level: 'info',
          area,
          title: '別の実行が、書き込み中です',
          detail: `保持者 ${lock.holder}`,
          hint: '終わるまで、待ってください(seiri status で、様子を見られます)',
        });
      } else if (running > 0) {
        findings.push({
          level: 'warn',
          area,
          title: `実行中のまま止まっている実行が ${running} 件あります`,
          hint: '次の本実行が、中断として記録します。何もしなくて大丈夫です',
        });
      } else {
        findings.push({
          level: 'ok',
          area,
          title: 'ロック・実行の状態は、正常です',
        });
      }
    } else if (connected) {
      findings.push({
        level: 'warn',
        area,
        title: 'この Mac に、このライブラリの台帳がありません',
        hint: '別の Mac の台帳か、この Mac の data/ が消えています。ドライブのスナップショットから復元できます',
      });
    }

    if (!connected) return findings;

    // ドライブの上の確認
    const snapshot = snapshotPathOf(library.root);
    if (!existsSync(snapshot)) {
      findings.push({
        level: 'warn',
        area,
        title: 'スナップショットが、ありません',
        hint: 'ドライブだけ持ち出すと、見られません。seiri events で、作り直せます',
      });
    } else if (working) {
      let behind = false;
      try {
        const copy = openLedger(snapshot, {
          mode: 'readonly',
          libraryId: library.id,
        });
        try {
          behind = getRevision(copy.db) < getRevision(working.db);
        } finally {
          copy.close();
        }
      } catch (error) {
        findings.push({
          level: 'error',
          area,
          title: 'スナップショットを開けません',
          detail: error instanceof Error ? error.message : String(error),
          hint: 'seiri events で、作り直せます',
        });
      }
      if (behind) {
        findings.push({
          level: 'warn',
          area,
          title: 'スナップショットが、この Mac の台帳より古いです',
          hint: 'seiri events で、最新にできます(家の PC で、古い内容が見えます)',
        });
      } else {
        findings.push({
          level: 'ok',
          area,
          title: 'スナップショットは、最新です',
        });
      }
    }

    const parts = listPartFiles(library.root);
    if (parts.length > 0) {
      findings.push({
        level: 'warn',
        area,
        title: `中断で残った一時ファイルが ${parts.length} 件あります`,
        detail: sample(parts),
        hint: '次の本実行の最初にも、掃除されます',
        fix: {
          label: `一時ファイル ${parts.length} 件を、削除する`,
          run: () => {
            const result = cleanupPartFiles(library.root);
            return `一時ファイルを ${result.removed.length} 件削除しました${result.failed.length > 0 ? `(消せなかった: ${result.failed.length} 件)` : ''}`;
          },
        },
      });
    }
    const volume = context.resolveVolume(library.root);
    if (usesAppleDouble(volume.fsType)) {
      const doubles = listAppleDoubleFiles(library.root);
      if (doubles.length > 0) {
        findings.push({
          level: 'warn',
          area,
          title: `macOS の付属ファイル(._名前)が ${doubles.length} 件あります`,
          detail: sample(doubles),
          hint: 'Windows から見ると、ファイルが 2 倍に見えます(本体は、無事です)',
          fix: {
            label: `付属ファイル ${doubles.length} 件を、削除する`,
            run: () => {
              const result = cleanupAppleDouble(library.root);
              return `付属ファイルを ${result.removed.length} 件削除しました${result.failed.length > 0 ? `(消せなかった: ${result.failed.length} 件)` : ''}`;
            },
          },
        });
      }
    }
    if (
      volume.totalBytes > 0 &&
      (volume.freeBytes / volume.totalBytes < LOW_FREE_RATIO ||
        volume.freeBytes < LOW_FREE_BYTES)
    ) {
      findings.push({
        level: 'warn',
        area,
        title: `ドライブの空きが少なくなっています(${formatBytes(volume.freeBytes)} / ${formatBytes(volume.totalBytes)})`,
        hint: '取り込みの前に、容量を確かめます(dry-run で、見積りが出ます)',
      });
    }
  } finally {
    working?.close();
  }
  return findings;
};

/** 深い診断: ライブラリの全ファイルの、存在・大きさ・サムネイルを、確かめる(中身のハッシュは、読まない。それは seiri verify) */
const checkLibraryDeep = (
  context: CommandContext,
  library: RegisteredLibrary
): Finding[] => {
  const area = `ライブラリ ${short(library.id)}(深い診断)`;
  const path = ledgerPathFor(context.dataDir, library.id);
  if (!existsSync(path) || library.state !== 'connected') return [];
  const ledger = openLedger(path, { mode: 'readonly', libraryId: library.id });
  try {
    const rows = ledger.db
      .query<
        { relPath: string; sizeBytes: number; thumbRelPath: string | null },
        []
      >(
        `SELECT f.rel_path AS relPath, c.size_bytes AS sizeBytes, f.thumb_rel_path AS thumbRelPath
         FROM library_files AS f JOIN contents AS c ON c.content_id = f.content_id`
      )
      .all();
    const missing: string[] = [];
    const wrongSize: string[] = [];
    let noThumb = 0;
    const lostThumbs: string[] = [];
    const thumbs = thumbsDirFor(context.dataDir, library.id);
    for (const row of rows) {
      const file = join(library.root, row.relPath);
      try {
        const stat = statSync(file);
        if (stat.size !== row.sizeBytes) wrongSize.push(row.relPath);
      } catch {
        missing.push(row.relPath);
        continue;
      }
      if (/\.xmp$/i.test(row.relPath)) continue;
      if (!row.thumbRelPath) noThumb += 1;
      else if (!existsSync(join(thumbs, row.thumbRelPath)))
        lostThumbs.push(row.relPath);
    }
    const findings: Finding[] = [];
    if (missing.length > 0) {
      findings.push({
        level: 'error',
        area,
        title: `台帳にあるのに、ファイルが見つからないものが ${missing.length} 件あります`,
        detail: sample(missing),
        hint: 'ドライブから消えた(または、移動した)ファイルです。seiri verify で、くわしく照合できます',
      });
    }
    if (wrongSize.length > 0) {
      findings.push({
        level: 'error',
        area,
        title: `台帳と大きさが違うファイルが ${wrongSize.length} 件あります(壊れた・書き換わった可能性)`,
        detail: sample(wrongSize),
        hint: 'seiri verify で、中身を照合できます(修復や削除は、しません)',
      });
    }
    if (noThumb > 0 || lostThumbs.length > 0) {
      findings.push({
        level: 'warn',
        area,
        title: `サムネイルがないものが ${noThumb + lostThumbs.length} 件あります`,
        hint: 'seiri thumbs で、作れます(何度でも実行できます)',
      });
    }
    if (findings.length === 0) {
      findings.push({
        level: 'ok',
        area,
        title: `ファイル ${rows.length} 件の、存在・大きさ・サムネイルは、正常です`,
      });
    }
    return findings;
  } finally {
    ledger.close();
  }
};

/** 外のコマンドの診断(なくても、取り込みは動く。使えなくなる機能を、知らせる) */
const checkTools = (context: CommandContext): Finding[] => {
  const tools: { name: string; use: string; onlyDarwin?: boolean }[] = [
    {
      name: 'perl',
      use: '写真・動画のメタデータの読み取り(ExifTool)。これがないと、取り込めません',
    },
    { name: 'ffmpeg', use: '動画のサムネイル・破損の検査と修復' },
    {
      name: 'sips',
      use: 'HEIC・RAW のサムネイル(macOS 標準)',
      onlyDarwin: true,
    },
  ];
  const missing = tools.filter(
    (tool) =>
      (!tool.onlyDarwin || process.platform === 'darwin') &&
      !context.findTool(tool.name)
  );
  if (missing.length === 0) {
    return [
      {
        level: 'ok',
        area: '外のコマンド',
        title: 'perl・ffmpeg・sips は、そろっています',
      },
    ];
  }
  return missing.map((tool) => ({
    level: tool.name === 'perl' ? ('error' as const) : ('warn' as const),
    area: '外のコマンド',
    title: `${tool.name} が見つかりません`,
    detail: `使えなくなるもの: ${tool.use}`,
    hint:
      tool.name === 'ffmpeg'
        ? 'brew install ffmpeg で、入れられます'
        : `${tool.name} を、入れてください`,
  }));
};

/** すべての診断を行う(何も書かない。直すのは、`fix` を呼んだときだけ) */
export const runChecks = (
  context: CommandContext,
  scope: { libraryRoot?: string; deep?: boolean } = {}
): Finding[] => {
  const all = listRegisteredLibraries(context);
  const targets = all.filter(
    (library) =>
      library.state !== 'stale' &&
      (!scope.libraryRoot || library.root === scope.libraryRoot)
  );
  return [
    ...checkRegistrations(context, all),
    ...checkDrives(context, all),
    ...targets.flatMap((library) => checkLibrary(context, library)),
    ...(scope.deep
      ? targets.flatMap((library) => checkLibraryDeep(context, library))
      : []),
    ...checkOrphans(context, all),
    ...checkTools(context),
  ];
};
