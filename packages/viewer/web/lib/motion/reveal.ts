import { gsap } from 'gsap';
import { CLEAR, type Cleanup, EASE, run } from './core';

/** 一覧のカードを、先頭から、この数だけ動かす(数千件を、いっぺんに動かさない) */
const FIRST_CARDS = 12;

/** 画面に見えているものだけ */
const visible = (selector: string): Element[] =>
  gsap.utils
    .toArray<Element>(selector)
    .filter((element) => (element as HTMLElement).offsetParent !== null);

/** 画面を開いたとき: `data-motion="title"` のあと、`data-motion="block"` を、順に出す */
export const revealPage = (scope: Element | null): Cleanup =>
  run(scope, () => {
    const titles = visible("[data-motion='title']");
    const blocks = visible("[data-motion='block']");
    if (titles.length > 0) {
      gsap.from(titles, {
        y: 24,
        opacity: 0,
        duration: 0.6,
        ease: EASE,
        clearProps: CLEAR,
      });
    }
    if (blocks.length > 0) {
      gsap.from(blocks, {
        y: 20,
        opacity: 0,
        duration: 0.55,
        delay: 0.1,
        stagger: 0.07,
        ease: EASE,
        clearProps: CLEAR,
      });
    }
  });

/** 一覧のカード(`data-motion="card"`)を、先頭から 12 枚だけ、順に出す */
export const revealCards = (scope: Element | null): Cleanup =>
  run(scope, () => {
    const cards = gsap.utils
      .toArray<Element>("[data-motion='card']")
      .slice(0, FIRST_CARDS);
    if (cards.length > 0) {
      gsap.from(cards, {
        y: 24,
        opacity: 0,
        duration: 0.45,
        stagger: 0.04,
        ease: EASE,
        clearProps: CLEAR,
      });
    }
  });

/** 詳細カードを開いたとき。中の項目(`data-motion="detail-item"`)は、少し遅れて、順に出す */
export const revealDetail = (card: Element | null): Cleanup =>
  run(card, () => {
    gsap.fromTo(
      card,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: EASE, clearProps: CLEAR }
    );
    gsap.from("[data-motion='detail-item']", {
      x: 16,
      opacity: 0,
      duration: 0.4,
      delay: 0.15,
      stagger: 0.06,
      ease: EASE,
      clearProps: CLEAR,
    });
  });

/** 机のポラロイド(`data-motion="pol"`)が、少しずつ遅れて、上から落ちて、傾きに収まる(design.md §7)。先頭の 12 枚だけ */
export const revealDesk = (scope: Element | null): Cleanup =>
  run(scope, () => {
    const pols = gsap.utils
      .toArray<Element>("[data-motion='pol']")
      .slice(0, FIRST_CARDS);
    if (pols.length > 0) {
      gsap.from(pols, {
        y: -36,
        rotation: '+=7',
        opacity: 0,
        duration: 0.5,
        stagger: 0.04,
        ease: EASE,
        clearProps: CLEAR,
      });
    }
  });
