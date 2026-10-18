'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { SwapLabel } from '../motion/SwapLabel';

/** 書き出したことを、ラベルの入れ替え(「書き出しました ✓」)で、知らせる時間(ミリ秒) */
const DONE_MS = 2200;

/** CSV の書き出しボタン。押すと、ブラウザが保存し、ラベルが、少しの間、入れ替わる */
export function CsvButton({ href }: { href: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const handleClick = (): void => {
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), DONE_MS);
  };
  return (
    <Button href={href} download onClick={handleClick}>
      <SwapLabel
        active={done}
        label="CSV で書き出す"
        activeLabel="書き出しました ✓"
      />
    </Button>
  );
}
