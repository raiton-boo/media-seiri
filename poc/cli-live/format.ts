import stringWidth from 'string-width';
import type { LogLine } from './simulate.ts';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SPARKLINE_LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;
const SPINNER_INTERVAL_MILLISECONDS = 80;

export const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.floor(milliseconds / MILLISECONDS_PER_SECOND);
  const hours = Math.floor(
    totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR)
  );
  const minutes =
    Math.floor(totalSeconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

export const formatNumber = (value: number): string =>
  value.toLocaleString('en-US');

export const formatLog = (log: LogLine): string =>
  `${log.time} ${log.level.padEnd(5)} ${log.message}`;

/** 数値の並びを、1 文字ずつの棒グラフにする(最大値を、いちばん高い棒にする) */
export const sparkline = (values: number[], width: number): string => {
  const recent = values.slice(-width);
  const max = Math.max(...recent, 1);
  const bars = recent.map((value) => {
    const level = Math.min(
      SPARKLINE_LEVELS.length - 1,
      Math.floor((value / max) * SPARKLINE_LEVELS.length)
    );
    return SPARKLINE_LEVELS[level] ?? SPARKLINE_LEVELS[0];
  });
  return bars.join('').padStart(width, ' ');
};

/** 経過時間から、スピナーの絵を決める(別のタイマーを持たず、描画の回数を増やさないため) */
export const spinnerFrame = (elapsedMilliseconds: number): string =>
  SPINNER_FRAMES[
    Math.floor(elapsedMilliseconds / SPINNER_INTERVAL_MILLISECONDS) %
      SPINNER_FRAMES.length
  ] ?? SPINNER_FRAMES[0];

/** 全角文字を 2 桁と数えた、表示の幅 */
export const displayWidth = (text: string): number => stringWidth(text);

/** 項目名の後ろを、点で埋めて、幅をそろえる(hashcat の状態の画面のような見た目) */
export const withLeaders = (label: string, width: number): string =>
  `${label}${'.'.repeat(Math.max(1, width - displayWidth(label)))}`;

const BAR_GRAPH_LEVELS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const LEVELS_PER_ROW = 8;

/** 数値の並びを、複数行の棒グラフにする。上の行から順に返す */
export const barGraph = (
  values: number[],
  width: number,
  height: number
): string[] => {
  const recent = values.slice(-width);
  const max = Math.max(...recent, 1);
  const padded = [
    ...Array.from({ length: width - recent.length }, () => 0),
    ...recent,
  ];
  return Array.from({ length: height }, (_, rowFromTop) => {
    const rowFromBottom = height - 1 - rowFromTop;
    return padded
      .map((value) => {
        const level = Math.round((value / max) * height * LEVELS_PER_ROW);
        const fill = Math.min(
          LEVELS_PER_ROW,
          Math.max(0, level - rowFromBottom * LEVELS_PER_ROW)
        );
        return BAR_GRAPH_LEVELS[fill] ?? ' ';
      })
      .join('');
  });
};

const MATRIX_CHARACTERS = Array.from('ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ABCDEF');
const MATRIX_STEP_MILLISECONDS = 100;
const MATRIX_PRIME_A = 7919;
const MATRIX_PRIME_B = 104729;

/** 流れる文字(Matrix 風)。時間で変わる、決まった乱数の並び */
export const matrixRain = (
  width: number,
  elapsedMilliseconds: number
): string => {
  const step = Math.floor(elapsedMilliseconds / MATRIX_STEP_MILLISECONDS);
  return Array.from({ length: width }, (_, index) => {
    const position =
      (index * MATRIX_PRIME_A + step * MATRIX_PRIME_B + index * index) %
      MATRIX_CHARACTERS.length;
    return MATRIX_CHARACTERS[position] ?? '0';
  }).join('');
};

/** 現在のファイルの SHA-256(見た目の確認用。ファイル名と進み具合から作る、実際の中身のハッシュではない) */
export const sampleDigest = (seed: string): string =>
  new Bun.CryptoHasher('sha256').update(seed).digest('hex');

/** 表示の幅が width 桁に収まるように、後ろを … で省く(全角文字は 2 桁と数える) */
export const truncateToWidth = (text: string, width: number): string => {
  if (displayWidth(text) <= width) return text;
  let result = '';
  for (const character of text) {
    if (displayWidth(`${result}${character}…`) > width) break;
    result += character;
  }
  return `${result}…`;
};

const BYTES_PER_GIB = 1024 ** 3;

export const formatGigabytes = (bytes: number): string =>
  `${(bytes / BYTES_PER_GIB).toFixed(1)} GB`;

const CONVEYOR_STEP_MILLISECONDS = 110;

/** 流れる印(◆)が動く線。区間の長さと、時間と、印の間隔から、決まった形を作る */
export const conveyor = (
  length: number,
  elapsedMilliseconds: number,
  spacing: number,
  offset: number
): string => {
  const shift =
    Math.floor(elapsedMilliseconds / CONVEYOR_STEP_MILLISECONDS) + offset;
  return Array.from({ length }, (_, position) =>
    (((position - shift) % spacing) + spacing) % spacing === 0 ? '◆' : '━'
  ).join('');
};

/** 全角文字を 2 桁と数えて、右に空白を足し、width 桁にそろえる */
export const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;

const DIGEST_PLACEHOLDER = '░';

/** 計算の途中のハッシュ(先頭から、ratio の割合だけ見せ、残りを ░ にする) */
export const partialDigest = (digest: string, ratio: number): string => {
  const known = Math.floor(digest.length * Math.min(Math.max(ratio, 0), 1));
  return `${digest.slice(0, known)}${DIGEST_PLACEHOLDER.repeat(digest.length - known)}`;
};

const MINI_BAR_FILLED = '▰';
const MINI_BAR_EMPTY = '▱';

/** 小さな進捗(▰▰▰▱▱) */
export const miniBar = (ratio: number, width: number): string => {
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return `${MINI_BAR_FILLED.repeat(filled)}${MINI_BAR_EMPTY.repeat(width - filled)}`;
};
