import type { ReactNode } from 'react';
import { Tick } from './motion/Tick';

/**
 * 絞り込みの札。選んでいるものは、黒く塗って「✓」を付ける(色だけでなく、印でも分かるように)。
 * 選んでいないものは、白。`tone` を渡すと、意味の色(エラーの赤)の背景に、白い文字にする(選んだものは、✓ と、太い枠で分かる)。
 */
export function FilterChip({
  selected,
  onClick,
  tone,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  tone?: 'r';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={['chip lg', tone ?? '', selected ? 'on' : '']
        .filter(Boolean)
        .join(' ')}
      aria-pressed={selected}
      onClick={onClick}
    >
      {selected ? <Tick /> : null}
      {children}
    </button>
  );
}
