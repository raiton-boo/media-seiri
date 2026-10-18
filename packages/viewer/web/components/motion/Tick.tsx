'use client';

import { useLayoutEffect, useRef } from 'react';
import { popIn } from '../../lib/motion/effects';

/** 札の「✓」。出るとき、小さいところから、ふくらむ */
export function Tick() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => popIn(ref.current), []);
  return (
    <span ref={ref} className="tick" style={{ display: 'inline-block' }}>
      ✓
    </span>
  );
}
