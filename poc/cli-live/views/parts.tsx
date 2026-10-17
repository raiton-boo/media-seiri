import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { displayWidth } from '../format.ts';
import { type ColorName, colorMode, mixColor, paint } from '../theme.ts';

type BadgeProps = {
  label: string;
  background: ColorName;
  foreground?: ColorName;
};

/** 色つきの札。色を使わないときは、[ ] で囲んで、見分けられるようにする */
export const Badge = ({ label, background, foreground = 'ink' }: BadgeProps) =>
  colorMode === 'none' ? (
    <Text bold>{`[${label}]`}</Text>
  ) : (
    <Text backgroundColor={paint(background)} color={paint(foreground)} bold>
      {` ${label} `}
    </Text>
  );

type ProgressBarProps = {
  ratio: number;
  width: number;
  from: ColorName;
  to: ColorName;
};

/** 進捗バー。24bit カラーの端末では、左から右へ、色がなめらかに変わる */
export const ProgressBar = ({ ratio, width, from, to }: ProgressBarProps) => {
  const filled = Math.floor(ratio * width);
  const cells = Array.from({ length: filled }, (_, index) => index);
  return (
    <Text>
      {cells.map((index) => (
        <Text
          key={index}
          color={mixColor(from, to, index / Math.max(width - 1, 1))}
        >
          █
        </Text>
      ))}
      <Text color={paint('grey')}>{'░'.repeat(width - filled)}</Text>
    </Text>
  );
};

type GradientTextProps = {
  text: string;
  from: ColorName;
  to: ColorName;
  bold?: boolean;
};

/** 文字ごとに色が変わる文字列(24bit カラーの端末だけ。ほかは、始まりの色) */
export const GradientText = ({
  text,
  from,
  to,
  bold = false,
}: GradientTextProps) => {
  // 文字の並びは変わらないため、位置から作った番号を、目印(key)にする
  const characters = Array.from(text).map((character, position) => ({
    id: position,
    character,
  }));
  return (
    <Text bold={bold}>
      {characters.map(({ id, character }) => (
        <Text
          key={id}
          color={mixColor(from, to, id / Math.max(characters.length - 1, 1))}
        >
          {character}
        </Text>
      ))}
    </Text>
  );
};

type PanelProps = {
  title: string;
  width: number;
  color: ColorName;
  /** 指定すると、パネルの中を、この色で塗る(背景が透明な端末でも、読めるようにするため) */
  background?: ColorName;
  children: ReactNode;
};

/** タイトルが枠線に入るパネル(btop・lazygit のような見た目) */
export const Panel = ({
  title,
  width,
  color,
  background,
  children,
}: PanelProps) => {
  const fixedWidth = 5;
  const dashes = '─'.repeat(
    Math.max(0, width - displayWidth(title) - fixedWidth)
  );
  const backgroundColor = background ? paint(background) : undefined;
  return (
    <Box flexDirection="column" width={width}>
      <Text
        color={paint(color)}
        backgroundColor={backgroundColor}
      >{`╭─ ${title} ${dashes}╮`}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderTop={false}
        borderColor={paint(color)}
        borderBackgroundColor={backgroundColor}
        backgroundColor={backgroundColor}
        paddingX={1}
        width={width}
      >
        {children}
      </Box>
    </Box>
  );
};
