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
