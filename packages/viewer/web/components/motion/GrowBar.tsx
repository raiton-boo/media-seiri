'use client';

import { useLayoutEffect, useRef } from 'react';
import { revealDelayOf } from '../../lib/motion/core';
import { growBar } from '../../lib/motion/effects';

/** 進捗バーの中身(`.bar` の中の塗り)。0 から、いまの幅まで伸び、幅が変わると、そこまで伸びる */
export function GrowBar({ percent }: { percent: number }) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = percent;
    const delay =
      !mounted.current && ref.current ? revealDelayOf(ref.current) : 0;
    mounted.current = true;
    return growBar(ref.current, percent, from, delay);
  }, [percent]);
  return <i ref={ref} />;
}
