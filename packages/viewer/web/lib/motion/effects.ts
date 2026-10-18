import { gsap } from 'gsap';
import { CLEAR, type Cleanup, EASE, isMotionEnabled, NOOP, run } from './core';

/** 失敗などで、左右に揺らす。続けて呼ばれたら、前の揺れを止めて、やり直す */
export const shake = (element: Element | null): void => {
  if (!element || !isMotionEnabled()) return;
  gsap.killTweensOf(element);
  gsap
    .timeline({ defaults: { duration: 0.07, ease: 'power1.inOut' } })
    .to(element, { x: -10, rotation: -0.6 })
    .to(element, { x: 9, rotation: 0.5 })
    .to(element, { x: -6, rotation: 0 })
    .to(element, { x: 4 })
    .to(element, { x: 0, clearProps: 'transform' });
};

/** 小さな印(✓ など)が、出るとき、小さいところから、ふくらむ */
export const popIn = (element: Element | null): Cleanup =>
  run(element, () => {
    gsap.from(element, {
      scale: 0.4,
      opacity: 0,
      duration: 0.25,
      ease: EASE,
      clearProps: CLEAR,
    });
  });

/** 実行中の印(LIVE の点)が、ゆっくり、脈打つ */
export const pulse = (element: Element | null): Cleanup =>
  run(element, () => {
    gsap.to(element, {
      opacity: 0.25,
      duration: 0.7,
      ease: 'power1.inOut',
      repeat: -1,
      yoyo: true,
    });
  });

/** 進捗バーを、いまの幅から、新しい幅へ、伸ばす。`delay`(秒)のあいだは、いまの幅のまま(動きなしのときは、すぐ、その幅) */
export const growBar = (
  element: HTMLElement | null,
  percent: number,
  from: number,
  delay = 0
): Cleanup => {
  if (!element) return NOOP;
  const width = `${percent}%`;
  if (!isMotionEnabled()) {
    element.style.width = width;
    return NOOP;
  }
  const tween = gsap.fromTo(
    element,
    { width: `${from}%` },
    { width, duration: 0.6, delay, ease: EASE }
  );
  return () => {
    tween.kill();
    element.style.width = width;
  };
};

/** 数字を、いまの値から、新しい値へ、数え上げる。`delay`(秒)のあいだは、いまの値のまま(動きなしのときは、すぐ、その値) */
export const countUp = (
  element: HTMLElement | null,
  to: number,
  from: number,
  format: (value: number) => string,
  delay = 0
): Cleanup => {
  if (!element) return NOOP;
  if (!isMotionEnabled() || from === to) {
    element.textContent = format(to);
    return NOOP;
  }
  const state = { value: from };
  element.textContent = format(from);
  const tween = gsap.to(state, {
    value: to,
    duration: 0.9,
    delay,
    ease: EASE,
    onUpdate: () => {
      element.textContent = format(Math.round(state.value));
    },
  });
  return () => {
    tween.kill();
    element.textContent = format(to);
  };
};
