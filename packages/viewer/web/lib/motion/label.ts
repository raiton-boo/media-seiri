import { gsap } from 'gsap';
import { EASE, isMotionEnabled } from './core';

/** 1 文字ずつに分けた要素(`data-char`) */
const charsOf = (label: Element): Element[] =>
  Array.from(label.querySelectorAll('[data-char]'));

export type LabelSwapper = {
  show: (active: boolean) => void;
  stop: () => void;
};

/** 重ねた 2 つの文字(`base`・`alt`)を、1 文字ずつずらして、入れ替える。押し直しても、飛ばない(arcana-members と同じ) */
export const createLabelSwapper = (
  base: Element,
  alt: Element,
  initialActive: boolean
): LabelSwapper => {
  const baseChars = charsOf(base);
  const altChars = charsOf(alt);
  const timeline = gsap
    .timeline({ paused: true })
    .to(baseChars, {
      yPercent: -100,
      duration: 0.25,
      stagger: 0.03,
      ease: 'power3.in',
    })
    .fromTo(
      altChars,
      { yPercent: 100 },
      { yPercent: 0, duration: 0.4, stagger: 0.04, ease: EASE },
      0.12
    );
  timeline.progress(initialActive ? 1 : 0);

  return {
    show: (active) => {
      if (!isMotionEnabled()) {
        timeline.progress(active ? 1 : 0);
        return;
      }
      if (active) timeline.play();
      else timeline.reverse();
    },
    stop: () => {
      timeline.kill();
    },
  };
};
