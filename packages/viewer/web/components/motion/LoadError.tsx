'use client';

import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { shake } from '../../lib/motion/effects';

/** 読み込みの失敗の注意書き。出るとき、左右に揺れて、気づかせる */
export function LoadError({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    shake(ref.current);
  }, []);
  return (
    <div ref={ref} className="note" role="alert">
      {children}
    </div>
  );
}
