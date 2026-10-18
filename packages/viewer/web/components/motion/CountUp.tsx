'use client';

import { useLayoutEffect, useRef } from 'react';
import { formatCount } from '../../lib/format';
import { revealDelayOf } from '../../lib/motion/core';
import { countUp } from '../../lib/motion/effects';

/**
 * 数字。開いたとき、そのカードが出てきてから、0 から数え上がる。値が変わったときは、いまの値から、新しい値へ。
 * 文字は、動きのために、この部品が直接書く(画面の読み上げには出さない)。読み上げには、最後の値を、別に出す。
 */
export function CountUp({
  value,
  format = formatCount,
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = value;
    // 画面を開いたときだけ、そのカードが出てくるのを待つ。値が変わったときは、すぐ
    const delay =
      !mounted.current && ref.current ? revealDelayOf(ref.current) : 0;
    mounted.current = true;
    return countUp(ref.current, value, from, format, delay);
  }, [value, format]);
  return (
    <>
      <span ref={ref} aria-hidden="true" />
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
