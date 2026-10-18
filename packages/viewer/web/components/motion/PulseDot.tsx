'use client';

import { useLayoutEffect, useRef } from 'react';
import { pulse } from '../../lib/motion/effects';

/** 実行中の印の点。ゆっくり、脈打つ */
export function PulseDot({ className = 'dot r' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => pulse(ref.current), []);
  return <span ref={ref} className={className} aria-hidden="true" />;
}
