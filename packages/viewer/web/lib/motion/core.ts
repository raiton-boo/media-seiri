import { gsap } from 'gsap';

// 動きは、弾まず、ゆっくり止まるものだけにする(arcana-members と同じ。design.md §7)
export const EASE = 'power3.out';
/** 動きのあとに、GSAP が付けた直書きのスタイルを消す(CSS に、見た目を戻す) */
export const CLEAR = 'transform,opacity';

export type Cleanup = () => void;
export const NOOP: Cleanup = () => {};

/** OS の「視差効果を減らす」設定のとき、false */
export const isMotionEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `scope` の中だけを動かす。返す関数で、元の見た目に戻す(`useEffect` の戻り値に渡せる) */
export const run = (scope: Element | null, build: () => void): Cleanup => {
  if (!scope || !isMotionEnabled()) return NOOP;
  const context = gsap.context(build, scope);
  return () => context.revert();
};

/** ブロックの出現の、最初の遅れと、1 つごとの遅れ(秒)。`reveal.ts` と、数字・バーの開始の計算で、共有する */
export const BLOCK_DELAY = 0.1;
export const BLOCK_STAGGER = 0.07;
/** カードが、出てきて、ほぼ見えるようになるまでの時間(秒)。数字は、これを待ってから、始める */
const BLOCK_SETTLE = 0.3;

/**
 * 画面を開いたとき、`element` を含むブロック(`data-motion="block"`)が、ほぼ見えるようになる時刻(秒)。
 * 数字の数え上がり・バーの伸びを、そのカードが出てきてから始めるために使う。ブロックの中でなければ、0。
 */
export const revealDelayOf = (element: Element): number => {
  const block = element.closest("[data-motion='block']");
  if (!block) return 0;
  const blocks = gsap.utils
    .toArray<Element>("[data-motion='block']")
    .filter((candidate) => (candidate as HTMLElement).offsetParent !== null);
  const index = blocks.indexOf(block);
  return index < 0 ? 0 : BLOCK_DELAY + index * BLOCK_STAGGER + BLOCK_SETTLE;
};
