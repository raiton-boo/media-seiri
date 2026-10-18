'use client';

import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { revealCards, revealDetail, revealPage } from '../../lib/motion/reveal';

type Props = { className?: string; children: ReactNode };

/** 画面全体。開いたとき、`data-motion="title"` のあと、`data-motion="block"` を、順に出す */
export function RevealPage({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => revealPage(ref.current), []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * 一覧。表示されたとき、中のカード(`data-motion="card"`)を、順に出す。
 * 絞り込み・ページ送りで、中身が入れ替わるときは、呼び出し側が `key` を変えて、作り直す。
 */
export function RevealCards({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => revealCards(ref.current), []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** 詳細カード。表示されたとき、下から入り、中の項目(`data-motion="detail-item"`)が、順に出る */
export function RevealDetail({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => revealDetail(ref.current), []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
