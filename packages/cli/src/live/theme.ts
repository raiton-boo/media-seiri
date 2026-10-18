// 配色は、Web 画面のデザイントークン(docs/design.md)と同じ。CLI と Web が、同じ世界観に見えるように

export type ColorName =
  | 'ink'
  | 'paper'
  | 'yellow'
  | 'pink'
  | 'blue'
  | 'green'
  | 'orange'
  | 'purple'
  | 'red'
  | 'matrix'
  | 'matrixDim'
  | 'cyan'
  | 'magenta'
  | 'violet'
  | 'grey'
  | 'dosBlue'
  | 'dosCyan'
  | 'panel'
  | 'text'
  | 'subtle';

type ColorMode = 'none' | 'basic' | 'truecolor';

// hex は 24bit カラーの端末用、basic は 16 色の端末用の代わりの色
const PALETTE: Record<ColorName, { hex: string; basic: string }> = {
  ink: { hex: '#0D0D0D', basic: 'black' },
  paper: { hex: '#FFFFFF', basic: 'white' },
  yellow: { hex: '#FFD93B', basic: 'yellow' },
  pink: { hex: '#FF86B5', basic: 'magenta' },
  blue: { hex: '#6C9BFF', basic: 'blue' },
  green: { hex: '#6EDB8F', basic: 'green' },
  orange: { hex: '#FF9F5A', basic: 'yellowBright' },
  purple: { hex: '#C1AEFF', basic: 'magentaBright' },
  red: { hex: '#FF5A4D', basic: 'red' },
  // サイバー・ハッカー・レトロ系の案で使う色
  matrix: { hex: '#00FF41', basic: 'greenBright' },
  matrixDim: { hex: '#008F11', basic: 'green' },
  cyan: { hex: '#00F0FF', basic: 'cyanBright' },
  magenta: { hex: '#FF007A', basic: 'magentaBright' },
  violet: { hex: '#BB9AF7', basic: 'magenta' },
  grey: { hex: '#565F89', basic: 'gray' },
  dosBlue: { hex: '#0000AA', basic: 'blue' },
  dosCyan: { hex: '#00AAAA', basic: 'cyan' },
  // 背景が透明な端末でも読めるように、パネルの中に塗る濃い紺と、その上で読みやすい文字の色
  panel: { hex: '#1A1B26', basic: 'black' },
  text: { hex: '#C0CAF5', basic: 'white' },
  subtle: { hex: '#9AA5CE', basic: 'gray' },
};

const HEX_RADIX = 16;
const COLOR_CHANNELS = 3;
const HEX_DIGITS_PER_CHANNEL = 2;

/**
 * 端末の色の対応を調べる。
 * NO_COLOR が設定されていれば、色を使わない(https://no-color.org。仕様: cli-logging.md §3)。
 * Ink は NO_COLOR を見ないため、こちらで、色の指定を外す。
 */
const detectColorMode = (): ColorMode => {
  if (process.env.NO_COLOR) return 'none';
  const colorTerminal = process.env.COLORTERM ?? '';
  return colorTerminal === 'truecolor' || colorTerminal === '24bit'
    ? 'truecolor'
    : 'basic';
};

export const colorMode = detectColorMode();

/** Ink の color・backgroundColor に渡す値。色を使わないときは undefined */
export const paint = (name: ColorName): string | undefined => {
  if (colorMode === 'none') return undefined;
  const entry = PALETTE[name];
  return colorMode === 'truecolor' ? entry.hex : entry.basic;
};

const toChannels = (hex: string): number[] =>
  Array.from({ length: COLOR_CHANNELS }, (_, index) =>
    Number.parseInt(
      hex.slice(
        1 + index * HEX_DIGITS_PER_CHANNEL,
        3 + index * HEX_DIGITS_PER_CHANNEL
      ),
      HEX_RADIX
    )
  );

/** 2 色の間の色(グラデーション用)。24bit カラーでないときは、始まりの色のまま */
export const mixColor = (
  from: ColorName,
  to: ColorName,
  ratio: number
): string | undefined => {
  if (colorMode !== 'truecolor') return paint(from);
  const fromChannels = toChannels(PALETTE[from].hex);
  const toChannelsValue = toChannels(PALETTE[to].hex);
  const mixed = fromChannels.map((channel, index) =>
    Math.round(
      channel + ((toChannelsValue[index] ?? channel) - channel) * ratio
    )
  );
  return `#${mixed.map((value) => value.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_CHANNEL, '0')).join('')}`;
};
