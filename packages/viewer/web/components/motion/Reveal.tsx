'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  revealCards,
  revealDesk,
  revealDetail,
  revealPage,
} from '../../lib/motion/reveal';

type Props = { className?: string; children: ReactNode };

/**
 * ページを開いている最中か。ふわっとした出現の動きは、**ページを新しく開いたとき(リロードを含む)だけ**にする。
 * ページの中の切り替え(ズーム・絞り込み・ページ送り・選択)で、中身が入れ替わっても、出現の動きは、再生しない。
 * 変わる部分だけを、それぞれの動き(定規の年の札が広がる、つまみが滑る、など)で、動かす。
 */
const OpeningContext = createContext(true);

/**
 * 部品が最初に作られた(マウントされた)ときに、ページを開いている最中だったか。以後は、変わらない。
 * (途中で `false` になっても、動いている最中の動きを、取り消さないため)
 */
const useOpenedWithPage = (): boolean => {
  const opening = useContext(OpeningContext);
  const [openedWithPage] = useState(opening);
  return openedWithPage;
};

/** 画面全体。開いたとき、`data-motion="title"` のあと、`data-motion="block"` を、順に出す */
export function RevealPage({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(true);
  useLayoutEffect(() => revealPage(ref.current), []);
  // 最初の描画(子の出現の動きの準備)が終わったら、「開いている最中」を終える
  useEffect(() => {
    setOpening(false);
  }, []);
  return (
    <OpeningContext.Provider value={opening}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </OpeningContext.Provider>
  );
}

/** 一覧。ページを開いたとき、中のカード(`data-motion="card"`)を、順に出す。絞り込み・ページ送りでは、出さない */
export function RevealCards({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useOpenedWithPage();
  useLayoutEffect(
    () => (animate ? revealCards(ref.current) : undefined),
    [animate]
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** 詳細カード。ページを開いたとき、下から入り、中の項目(`data-motion="detail-item"`)が、順に出る。選び直しでは、出さない */
export function RevealDetail({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useOpenedWithPage();
  useLayoutEffect(
    () => (animate ? revealDetail(ref.current) : undefined),
    [animate]
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** 机。ページを開いたとき、ポラロイド(`data-motion="pol"`)が、順に落ちてくる。ズーム・並び順の切り替えでは、出さない */
export function RevealDesk({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useOpenedWithPage();
  useLayoutEffect(
    () => (animate ? revealDesk(ref.current) : undefined),
    [animate]
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
