'use client';

import { useEffect } from 'react';

/**
 * 大きな数字(`.num`)が、枠(カード)から、はみ出さないよう、はみ出す分だけ、縮める(1 行のまま)。
 * 数字は、数え上がりの動きや、値の更新で、文字が変わるため、画面の変化を見て、測り直す。
 * 枠に収まるものは、そのまま(縮めない)。画面の中に、1 つだけ置く。
 */
export function NumFit() {
  useEffect(() => {
    let frame = 0;
    const fit = (): void => {
      frame = 0;
      for (const element of document.querySelectorAll<HTMLElement>('.num')) {
        element.style.transform = 'none';
        const available = element.clientWidth;
        const needed = element.scrollWidth;
        if (available > 0 && needed > available) {
          element.style.transformOrigin = 'left center';
          element.style.transform = `scale(${available / needed})`;
        }
      }
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(fit);
    };
    // 文字・要素の変化だけを見る(縮めるために書く `style` は、見ない。見ると、くり返す)
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
