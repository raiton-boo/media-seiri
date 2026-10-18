import type { ReactNode } from 'react';

/**
 * 絞り込みの札。選んでいるものは、黒く塗って「✓」を付ける(色だけでなく、印でも分かるように)。
 * 選んでいないものは、白。`marker` は、意味の色(エラーの赤など)の小さな四角。
 */
export function FilterChip({
  selected,
  onClick,
  marker,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  marker?: 'r' | 'y';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={selected ? 'chip lg on' : 'chip lg'}
      aria-pressed={selected}
      onClick={onClick}
    >
      {selected ? <span className="tick">✓</span> : null}
      {marker ? <span className={`dot ${marker}`} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
