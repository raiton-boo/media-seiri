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
  const bad = countOf(findings, 'error') + countOf(findings, 'warn');
  context.stdout(
    `\n診断: 要対応 ${bad} 件(問題 ${countOf(findings, 'error')} / 注意 ${countOf(findings, 'warn')})、知らせ ${countOf(findings, 'info')} 件、問題なし ${countOf(findings, 'ok')} 件`
  );
  return bad === 0 ? EXIT_CODES.ok : EXIT_CODES.completedWithErrors;
};
