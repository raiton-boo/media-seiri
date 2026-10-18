import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import { truncateToWidth } from '../live/format.ts';
import { Badge, GradientText, Panel } from '../live/parts.tsx';
import { paint } from '../live/theme.ts';

const MAX_WIDTH = 100;
const MIN_WIDTH = 40;
/** 枠・見出し・操作の案内などに使う、選択肢以外の行数 */
const CHROME_ROWS = 7;
const MIN_VISIBLE = 5;
const PANEL_CHROME_WIDTH = 4;

export type Item = { label: string; hint?: string };

/** 画面に出す、選択肢の範囲(選んでいる行が、真ん中あたりに来るように、動かす) */
export const windowRange = (
  index: number,
  count: number,
  size: number
): { start: number; end: number } => {
  const visible = Math.min(count, Math.max(1, size));
  const start = Math.min(
    Math.max(0, index - Math.floor(visible / 2)),
    count - visible
  );
  return { start, end: start + visible };
};

/** 矢印キーで動かした後の、選んでいる位置(端から先は、反対側へ回る) */
export const moveIndex = (index: number, count: number, step: number): number =>
  (((index + step) % count) + count) % count;

const widthOf = (columns: number): number =>
  Math.max(MIN_WIDTH, Math.min(columns, MAX_WIDTH));

type SelectViewProps = {
  message: string;
  items: readonly Item[];
  index: number;
  columns: number;
  rows: number;
  /** 決めたあとの、1 行だけの表示(画面に残る記録) */
  answered?: boolean;
};

/** 選ぶ画面(描くだけ。キー操作は、`SelectPrompt`) */
export const SelectView = ({
  message,
  items,
  index,
  columns,
  rows,
  answered = false,
}: SelectViewProps) => {
  const width = widthOf(columns);
  if (answered) {
    const chosen = items[index]?.label ?? '';
    return (
      <Text>
        <Text color={paint('green')}>✔ </Text>
        <Text color={paint('subtle')}>
          {truncateToWidth(message, width - 6)}
        </Text>
        <Text color={paint('yellow')}>{'  ➜  '}</Text>
        <Text bold>{truncateToWidth(chosen, width - 10)}</Text>
      </Text>
    );
  }
  const { start, end } = windowRange(
    index,
    items.length,
    Math.max(MIN_VISIBLE, rows - CHROME_ROWS)
  );
  const inner = width - PANEL_CHROME_WIDTH;
  const visible = items
    .slice(start, end)
    .map((item, offset) => ({ item, id: start + offset }));
  return (
    <Box flexDirection="column">
      <Panel
        title={truncateToWidth(message, width - 8)}
        width={width}
        color="yellow"
      >
        {start > 0 ? (
          <Text color={paint('subtle')}>{`  ↑ あと ${start} 件`}</Text>
        ) : null}
        {visible.map(({ item, id }) => {
          const selected = id === index;
          const text = truncateToWidth(
            item.hint ? `${item.label}  ${item.hint}` : item.label,
            inner - 4
          );
          return selected ? (
            <Text
              key={id}
              backgroundColor={paint('yellow')}
              color={paint('ink')}
              bold
            >{` ▸ ${text} `}</Text>
          ) : (
            <Text key={id} color={paint('text')}>{`   ${text}`}</Text>
          );
        })}
        {end < items.length ? (
          <Text
            color={paint('subtle')}
          >{`  ↓ あと ${items.length - end} 件`}</Text>
        ) : null}
      </Panel>
      <Text color={paint('subtle')}>
        {' '}
        <Badge label="↑↓" background="blue" /> えらぶ{' '}
        <Badge label="Enter" background="green" /> きめる{' '}
        <Badge label="q" background="pink" /> やめる
      </Text>
    </Box>
  );
};

type SelectPromptProps = {
  message: string;
  items: readonly Item[];
  columns: number;
  rows: number;
  onDone: (index: number) => void;
  onCancel: () => void;
};

/** 矢印キーで選ぶ(↑↓ / j k で動く。PageUp・PageDown で、まとめて。Enter で決める。q・Esc・Ctrl-C でやめる) */
export const SelectPrompt = ({
  message,
  items,
  columns,
  rows,
  onDone,
  onCancel,
}: SelectPromptProps) => {
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const page = Math.max(1, rows - CHROME_ROWS - 1);

  useInput((input, key) => {
    if (answered) return;
    if ((key.ctrl && input === 'c') || input === 'q' || key.escape) onCancel();
    else if (key.return) setAnswered(true);
    else if (key.upArrow || input === 'k')
      setIndex((current) => moveIndex(current, items.length, -1));
    else if (key.downArrow || input === 'j')
      setIndex((current) => moveIndex(current, items.length, 1));
    else if (key.pageUp) setIndex((current) => Math.max(0, current - page));
    else if (key.pageDown)
      setIndex((current) => Math.min(items.length - 1, current + page));
    else if (/^[1-9]$/.test(input) && Number(input) <= items.length)
      setIndex(Number(input) - 1);
  });

  // 決めた後は、1 行の記録に変えてから、閉じる
  useEffect(() => {
    if (answered) onDone(index);
  }, [answered, index, onDone]);

  return (
    <SelectView
      message={message}
      items={items}
      index={index}
      columns={columns}
      rows={rows}
      answered={answered}
    />
  );
};

type TextViewProps = {
  message: string;
  value: string;
  initial?: string;
  columns: number;
  answered?: boolean;
};

/** 文字を入力する画面(描くだけ) */
export const TextView = ({
  message,
  value,
  initial,
  columns,
  answered = false,
}: TextViewProps) => {
  const width = widthOf(columns);
  const shown = value === '' ? (initial ?? '') : value;
  if (answered) {
    return (
      <Text>
        <Text color={paint('green')}>✔ </Text>
        <Text color={paint('subtle')}>
          {truncateToWidth(message, width - 6)}
        </Text>
        <Text color={paint('yellow')}>{'  ➜  '}</Text>
        <Text bold>{truncateToWidth(shown, width - 10)}</Text>
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      <Panel
        title={truncateToWidth(message, width - 8)}
        width={width}
        color="yellow"
      >
        <Text>
          <Text color={paint('yellow')}>❯ </Text>
          {value === '' && initial ? (
            <Text color={paint('subtle')}>
              {truncateToWidth(initial, width - 10)}
            </Text>
          ) : (
            <Text>{truncateToWidth(value, width - 10)}</Text>
          )}
          <Text backgroundColor={paint('yellow')}> </Text>
        </Text>
      </Panel>
      <Text color={paint('subtle')}>
        {' '}
        <Badge label="Enter" background="green" />{' '}
        {initial ? 'きめる(空なら、薄い字の値)' : 'きめる'}{' '}
        <Badge label="Esc" background="pink" /> やめる{' '}
        <Badge label="Ctrl-U" background="blue" /> 全部消す
      </Text>
    </Box>
  );
};

type TextPromptProps = {
  message: string;
  initial?: string;
  columns: number;
  onDone: (value: string) => void;
  onCancel: () => void;
};

/** 1 行を入力する(貼り付け・ドラッグで入れたパスも、そのまま入る) */
export const TextPrompt = ({
  message,
  initial,
  columns,
  onDone,
  onCancel,
}: TextPromptProps) => {
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState(false);

  useInput((input, key) => {
    if (answered) return;
    if ((key.ctrl && input === 'c') || key.escape) onCancel();
    else if (key.return) setAnswered(true);
    // macOS の Backspace は、delete として届く
    else if (key.backspace || key.delete)
      setValue((current) => Array.from(current).slice(0, -1).join(''));
    else if (key.ctrl && input === 'u') setValue('');
    else if (input && !key.ctrl && !key.meta && !key.tab)
      setValue((current) => current + input.replace(/[\r\n]+/g, ''));
  });

  useEffect(() => {
    if (answered) onDone(value.trim() === '' ? (initial ?? '') : value);
  }, [answered, value, initial, onDone]);

  return (
    <TextView
      message={message}
      value={value}
      initial={initial}
      columns={columns}
      answered={answered}
    />
  );
};

/** 最初の、見出し(ロゴ) */
export const Banner = () => (
  <Box>
    <GradientText text="seiri" from="yellow" to="pink" bold />
    <Text color={paint('subtle')}>
      {'  写真・動画を、撮影日ごとに整理する'}
    </Text>
  </Box>
);
