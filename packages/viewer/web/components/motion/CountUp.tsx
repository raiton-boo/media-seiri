'use client';

import { useLayoutEffect, useRef } from 'react';
import { formatCount } from '../../lib/format';
import { countTiming, countUp } from '../../lib/motion/effects';

/**
 * 数字。開いたとき、0 から数え上がる(数字ごとに、開始と長さが違う)。値が変わったときは、いまの値から、新しい値へ。
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
    // 画面を開いたときだけ、数字ごとに、開始と長さを変える。値が変わったときは、すぐ、同じ速さで
    const element = ref.current;
    const index = element
      ? Array.from(document.querySelectorAll('[data-count]')).indexOf(element)
      : 0;
    const timing = mounted.current
      ? {}
      : countTiming(value, Math.max(0, index));
    mounted.current = true;
    return countUp(element, value, from, format, timing);
  }, [value, format]);
  return (
    <>
      <span ref={ref} data-count aria-hidden="true" />
      <span className="sr-only">{format(value)}</span>
    </>
  );
}
