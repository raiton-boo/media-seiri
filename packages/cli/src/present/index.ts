import type { CommandContext } from '../context.ts';
import type { Report } from './report.ts';
import { renderReport } from './report-view.tsx';

export type { Report, Row, Section, Tone } from './report.ts';

const DEFAULT_COLUMNS = 100;

/** 結果を、色つきの枠で出す(端末のときだけ使う。そうでなければ、呼び出し側が、文字だけの行を出す) */
export const showReport = (
  context: CommandContext,
  report: Report,
  write: (text: string) => void = context.stdout
): void => {
  write(renderReport(report, process.stdout.columns ?? DEFAULT_COLUMNS));
};
