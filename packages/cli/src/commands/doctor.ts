import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import cliPackage from '../../package.json' with { type: 'json' };
import type { CommandContext } from '../context.ts';
import { runChecks } from '../doctor/checks.ts';
import type { Finding } from '../doctor/types.ts';
import { EXIT_CODES, type ExitCode } from '../exit-codes.ts';
import { type Section, showReport } from '../present/index.ts';

export type DoctorArguments = {
  library: string | undefined;
  fix: boolean;
  yes: boolean;
  /** 深い診断(ファイルの存在・大きさ・サムネイル) */
  deep: boolean;
  /** 共有できる報告の書き出し先(`.json` なら JSON、それ以外は文章) */
  report: string | undefined;
  /** 報告に、パス・ファイル名も含める */
  includePaths: boolean;
};

const MARKS: Record<Finding['level'], string> = {
  ok: '✔',
  info: 'ℹ',
  warn: '⚠',
  error: '✘',
};

const countOf = (findings: Finding[], level: Finding['level']): number =>
  findings.filter((finding) => finding.level === level).length;

/** 診断の結果を、文字の行にする */
const plainLines = (findings: Finding[]): string[] => {
  const lines: string[] = [];
  for (const finding of findings) {
    lines.push(`${MARKS[finding.level]} [${finding.area}] ${finding.title}`);
    if (finding.level === 'ok') continue;
    for (const line of (finding.detail ?? '').split('\n').filter(Boolean)) {
      lines.push(`    ${line}`);
    }
    if (finding.hint) lines.push(`    対処: ${finding.hint}`);
    if (finding.fix)
      lines.push(`    自動で直せます: ${finding.fix.label}(--fix)`);
  }
  return lines;
};

/** 診断の結果を、色つきの枠にする(要対応・知らせ・問題なし) */
const showFindings = (context: CommandContext, findings: Finding[]): void => {
  const sections: Section[] = [];
  const attention = findings.filter(
    (f) => f.level === 'error' || f.level === 'warn'
  );
  const notices = findings.filter((f) => f.level === 'info');
  const fine = findings.filter((f) => f.level === 'ok');
  const block = (finding: Finding): string[] => [
    `${MARKS[finding.level]} [${finding.area}] ${finding.title}`,
    ...(finding.detail ?? '')
      .split('\n')
      .filter(Boolean)
      .map((line) => `    ${line}`),
    ...(finding.hint ? [`    対処: ${finding.hint}`] : []),
    ...(finding.fix ? [`    自動で直せます: ${finding.fix.label}(--fix)`] : []),
  ];
  if (attention.length > 0) {
    sections.push({
      title: `要対応 ${attention.length} 件`,
      tone: countOf(findings, 'error') > 0 ? 'error' : 'warn',
      lines: attention.flatMap(block),
    });
  }
  if (notices.length > 0) {
    sections.push({
      title: `知らせ ${notices.length} 件`,
      tone: 'info',
      lines: notices.flatMap(block),
    });
  }
  if (fine.length > 0) {
    sections.push({
      title: `問題なし ${fine.length} 件`,
      tone: 'ok',
      lines: fine.map((f) => `✔ [${f.area}] ${f.title}`),
    });
  }
  const bad = attention.length;
  showReport(context, {
    title: '診断',
    badge:
      bad === 0
        ? { label: '問題なし', tone: 'ok' }
        : {
            label: `要対応 ${bad} 件`,
            tone: countOf(findings, 'error') > 0 ? 'error' : 'warn',
          },
    sections,
    hint: findings.some((f) => f.fix)
      ? '自動で直せるものは、seiri doctor --fix で直せます(写真・台帳は、消しません)'
      : undefined,
  });
};

/** 外のコマンドの版(1 行目)。なければ undefined */
const toolVersion = (name: string, args: string[]): string | undefined => {
  try {
    const result = Bun.spawnSync([name, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text =
      `${result.stdout.toString()}${result.stderr.toString()}`.trim();
    return text.split('\n')[0]?.slice(0, 120) || undefined;
  } catch {
    return undefined;
  }
};

/** 報告に出す文字から、利用者のホームのパスを、伏せる */
const redactHome = (text: string): string => text.split(homedir()).join('~');

/**
 * 診断の報告を、ファイルに書き出す(問題を、そのまま共有できるように)。
 * 既定では、パス・ファイル名(`detail`)は、含めない。`--include-paths` で、含める(ホームのパスは、`~` に置き換える)。
 */
const writeReport = (
  context: CommandContext,
  target: string,
  findings: Finding[],
  includePaths: boolean
): string => {
  const path = resolve(target);
  const environment = {
    seiriVersion: cliPackage.version,
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    standalone: false,
    tools: {
      perl: toolVersion('perl', ['-e', 'print $^V']),
      ffmpeg: toolVersion('ffmpeg', ['-version']),
      sips: context.findTool('sips') ? 'あり' : undefined,
    },
  };
  const items = findings.map((finding) => ({
    level: finding.level,
    area: finding.area,
    title: redactHome(finding.title),
    ...(includePaths && finding.detail
      ? { detail: redactHome(finding.detail) }
      : {}),
    ...(finding.hint ? { hint: finding.hint } : {}),
    fixable: Boolean(finding.fix),
  }));
  const summary = {
    error: countOf(findings, 'error'),
    warn: countOf(findings, 'warn'),
    info: countOf(findings, 'info'),
    ok: countOf(findings, 'ok'),
  };
  const body = path.toLowerCase().endsWith('.json')
    ? `${JSON.stringify(
        {
          createdAt: context.now().toISOString(),
          includePaths,
          environment,
          summary,
          findings: items,
        },
        null,
        2
      )}\n`
    : [
        `seiri 診断の報告 ${context.now().toISOString()}`,
        `seiri ${environment.seiriVersion} / bun ${environment.bun} / ${environment.platform} ${environment.arch}`,
        `perl: ${environment.tools.perl ?? 'なし'} / ffmpeg: ${environment.tools.ffmpeg ?? 'なし'} / sips: ${environment.tools.sips ?? 'なし'}`,
        `要対応 ${summary.error + summary.warn} 件(問題 ${summary.error} / 注意 ${summary.warn})、知らせ ${summary.info} 件、問題なし ${summary.ok} 件`,
        '',
        ...items.flatMap((item) => [
          `${MARKS[item.level]} [${item.area}] ${item.title}`,
          ...('detail' in item && item.detail
            ? item.detail.split('\n').map((l) => `    ${l}`)
            : []),
          ...(item.hint ? [`    対処: ${item.hint}`] : []),
        ]),
        '',
      ].join('\n');
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, body);
  renameSync(temporary, path);
  return path;
};

/**
 * `doctor [--library <パス>] [--fix] [-y]`: トラブルの診断。何も書き換えず、見つけた問題と、対処を案内する。
 * `--fix` で、安全に直せるもの(古い登録の削除・中断で残った一時ファイル・付属ファイルの掃除)だけを直す。
 * 写真・台帳は、消さない。終了コード: 0 問題なし / 1 要対応あり
 */
export const doctorCommand = async (
  context: CommandContext,
  args: DoctorArguments
): Promise<ExitCode> => {
  const libraryRoot = args.library ? args.library : undefined;
  let findings = runChecks(context, { libraryRoot, deep: args.deep });
  const show = (items: Finding[]): void => {
    if (context.fancy) showFindings(context, items);
    else for (const line of plainLines(items)) context.stdout(line);
  };
  show(findings);

  if (args.fix) {
    const fixes = findings.filter((finding) => finding.fix);
    if (fixes.length === 0) {
      context.stdout('\n自動で直せるものは、ありません。');
    } else {
      context.stdout('\n次を、直します:');
      for (const finding of fixes) context.stdout(`  - ${finding.fix?.label}`);
      const go =
        args.yes ||
        (context.isInteractive && (await context.confirm('直しますか')));
      if (!go) {
        context.stdout(
          args.yes || context.isInteractive
            ? '直しませんでした。'
            : '直すには、--yes を付けて、もう一度実行してください。'
        );
        return EXIT_CODES.failed;
      }
      for (const finding of fixes) context.stdout(`  ✔ ${finding.fix?.run()}`);
      context.stdout('\n直したあとの診断:');
      findings = runChecks(context, { libraryRoot, deep: args.deep });
      show(findings);
    }
  }
  if (args.report) {
    const path = writeReport(context, args.report, findings, args.includePaths);
    context.stdout(
      `\n診断の報告を書き出しました: ${path}${args.includePaths ? '' : '(パス・ファイル名は、伏せてあります)'}`
    );
  }
  const bad = countOf(findings, 'error') + countOf(findings, 'warn');
  context.stdout(
    `\n診断: 要対応 ${bad} 件(問題 ${countOf(findings, 'error')} / 注意 ${countOf(findings, 'warn')})、知らせ ${countOf(findings, 'info')} 件、問題なし ${countOf(findings, 'ok')} 件`
  );
  return bad === 0 ? EXIT_CODES.ok : EXIT_CODES.completedWithErrors;
};
