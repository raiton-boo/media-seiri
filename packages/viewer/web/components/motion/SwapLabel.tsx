'use client';

import { useLayoutEffect, useRef } from 'react';
import { createLabelSwapper, type LabelSwapper } from '../../lib/motion/label';

// 動かせるように、1 文字ずつ分けて並べる
function Chars({ text }: { text: string }) {
  return Array.from(text).map((char, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 固定の文字列を分けただけで、並べ替えや途中の追加はない
    <span key={index} data-char className="inline-block">
      {char === ' ' ? ' ' : char}
    </span>
  ));
}

/**
 * ボタンの文字を、1 文字ずつ入れ替える(arcana-members の SwapLabel と同じ)。`active` が true のとき、`activeLabel` になる。
 * 幅は、広いほうにそろえて、変えない。
 */
export function SwapLabel({
  active,
  label,
  activeLabel,
}: {
  active: boolean;
  label: string;
  activeLabel: string;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const activeLabelRef = useRef<HTMLSpanElement>(null);
  const swapperRef = useRef<LabelSwapper | null>(null);
  const initialActive = useRef(active);

  // 最初に 1 回だけ、動かし役を用意する(見せないほうは、下で待たせる)
  useLayoutEffect(() => {
    const base = labelRef.current;
    const alt = activeLabelRef.current;
    if (!base || !alt) return;
    const swapper = createLabelSwapper(base, alt, initialActive.current);
    swapperRef.current = swapper;
    return () => swapper.stop();
  }, []);

  useLayoutEffect(() => {
    swapperRef.current?.show(active);
  }, [active]);

  return (
    <span className="swap grid overflow-hidden">
      <span
        ref={labelRef}
        aria-hidden={active}
        className="col-start-1 row-start-1 text-center"
      >
        <Chars text={label} />
      </span>
      <span
        ref={activeLabelRef}
        aria-hidden={!active}
        className="col-start-1 row-start-1 text-center"
      >
        <Chars text={activeLabel} />
      </span>
    </span>
  );
}
