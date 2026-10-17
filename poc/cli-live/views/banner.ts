// 太い罫線で描いた、3 行のロゴ(`cli-logging.md` の「仮」の項目)
const GLYPHS: Record<string, [string, string, string]> = {
  F: ['┏━╸', '┣╸ ', '╹  '],
  I: ['╻', '┃', '╹'],
  L: ['╻  ', '┃  ', '┗━╸'],
  E: ['┏━╸', '┣╸ ', '┗━╸'],
  '-': ['   ', '╺━╸', '   '],
  S: ['┏━┓', '┗━┓', '┗━┛'],
  R: ['┏━┓', '┣┳┛', '╹┗╸'],
};

const LOGO_TEXT = 'FILE-SEIRI';
const BANNER_ROWS = 3;

export const BANNER_LINES: string[] = Array.from(
  { length: BANNER_ROWS },
  (_, row) =>
    [...LOGO_TEXT].map((letter) => GLYPHS[letter]?.[row] ?? '').join(' ')
);
