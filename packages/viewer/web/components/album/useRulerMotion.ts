'use client';

import { gsap } from 'gsap';
import { type RefObject, useLayoutEffect, useRef } from 'react';
import { EASE, isMotionEnabled } from '../../lib/motion/core';

export type TileLayout = { year: number; grow: number; basis: number };

type Snapshot = {
  year: number;
  tiles: Map<number, TileLayout>;
  markerLeft: number;
};

/**
 * 時間の定規の、**変わる部分だけ**の動き(ページを作り直すような動きは、しない)。
 * - 年を選ぶ: その年の札が、広がる(幅が、いまの大きさから、新しい大きさへ)。月の棒は、低いところから、伸びる
 * - 月を選ぶ: つまみが、いまの位置から、新しい位置へ、滑る(棒の色は、CSS で、なめらかに変わる)
 * 最初の表示では、動かさない(ページを開いたときの動きは、別)。「視差効果を減らす」でも、動かさない。
 */
export const useRulerMotion = (
  root: RefObject<HTMLElement | null>,
  year: number,
  tiles: readonly TileLayout[],
  markerLeft: number
): void => {
  const previous = useRef<Snapshot | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tiles` は、毎回、新しい配列。中身(幅)の変化は、`year` と、各札の幅の文字列で見る
  useLayoutEffect(() => {
    const element = root.current;
    const before = previous.current;
    const snapshot: Snapshot = {
      year,
      tiles: new Map(tiles.map((tile) => [tile.year, tile])),
      markerLeft,
    };
    previous.current = snapshot;
    if (!element || !before || !isMotionEnabled()) return;

    const context = gsap.context(() => {
      // 年の札: 幅が変わったものだけ、広がる・縮む
      for (const tile of snapshot.tiles.values()) {
        const old = before.tiles.get(tile.year);
        if (!old || (old.grow === tile.grow && old.basis === tile.basis))
          continue;
        const target = element.querySelector(`[data-year="${tile.year}"]`);
        if (!target) continue;
        gsap.fromTo(
          target,
          { flexGrow: old.grow, flexBasis: old.basis },
          {
            flexGrow: tile.grow,
            flexBasis: tile.basis,
            duration: 0.5,
            ease: EASE,
            // `clearProps` は、使わない(React が付けた `flex` の指定まで、消してしまうため)。最後の値は、React の値と同じ
          }
        );
      }
      // 年が変わったら、新しく開いた年の月の棒が、低いところから伸びる
      if (before.year !== year) {
        const bars = element.querySelectorAll(`[data-year="${year}"] .mbars i`);
        if (bars.length > 0) {
          gsap.from(bars, {
            height: 4,
            duration: 0.45,
            stagger: 0.02,
            ease: EASE,
          });
        }
      }
      // つまみ: いまの位置から、新しい位置へ、滑る
      if (before.markerLeft !== markerLeft) {
        const marker = element.querySelector('.thumb');
        if (marker) {
          gsap.fromTo(
            marker,
            { left: `${before.markerLeft}%` },
            {
              left: `${markerLeft}%`,
              duration: 0.35,
              ease: EASE,
            }
          );
        }
      }
    }, element);
    return () => context.revert();
  }, [
    root,
    year,
    markerLeft,
    tiles.map((tile) => `${tile.year}:${tile.grow}:${tile.basis}`).join('|'),
  ]);
};
