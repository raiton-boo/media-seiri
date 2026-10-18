'use client';

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { type ReactNode, useEffect, useRef } from 'react';

gsap.registerPlugin(useGSAP);

type Variant = 'default' | 'y' | 'ink';

type Props = {
  children: ReactNode;
  variant?: Variant;
  /** 大きいボタン(影 6px)。主役の操作に使う */
  large?: boolean;
  /** 押せない。影を消して、灰色の平らな面になる */
  disabled?: boolean;
  /** 処理中。押せない(`disabled` と同じ見た目)が、カーソルは「待ち」にする */
  busy?: boolean;
  /** ページ移動のリンクとして使う */
  href?: string;
  /** `href` が、ファイルの書き出し(CSV など)のとき。画面の移動にせず、ブラウザの保存にする */
  download?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
};

/** 沈み込む前の、ホバーで浮く量(影に対する割合) */
const HOVER_LIFT = 0.25;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** CSS の `--sh`(影の大きさ。`3px`)を、数にする */
const shadowSize = (element: HTMLElement): number =>
  Number.parseFloat(getComputedStyle(element).getPropertyValue('--sh')) || 3;

/**
 * ボタン。見た目と構造は `neo.css` の `.btn`(外側が影・当たり判定、内側 `.face` が動く面)。
 * 動き(GSAP): ホバーで影の 1/4 だけ浮き、押すと影の位置まで沈み、離すと戻る。
 * 弾む(行き過ぎる)動きは付けない(`power3` 系)。「視差効果を減らす」のときは、GSAP を使わず、CSS の transition だけにする。
 * 押せない(`disabled`・`busy`)ときは、動かさない。キーボード(Enter・Space)でも、押した動きにする。
 */
export function Button({
  children,
  variant = 'default',
  large = false,
  disabled = false,
  busy = false,
  href,
  download = false,
  onClick,
  ariaLabel,
}: Props) {
  const root = useRef<HTMLElement | null>(null);
  const face = useRef<HTMLSpanElement | null>(null);
  const hovering = useRef(false);
  const inactive = disabled || busy;

  const { contextSafe } = useGSAP({ scope: root });

  // GSAP で動かすとき(「視差効果を減らす」でないとき)は、CSS の transition を外す(二重に動かないように)
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (prefersReducedMotion()) {
      delete element.dataset.gsap;
    } else {
      element.dataset.gsap = 'on';
    }
  }, []);

  const moveTo = contextSafe((state: 'rest' | 'hover' | 'press') => {
    const element = root.current;
    const target = face.current;
    if (!element || !target || element.dataset.gsap !== 'on') return;
    const size = shadowSize(element);
    const offset =
      state === 'press' ? size : state === 'hover' ? -size * HOVER_LIFT : 0;
    gsap.to(target, {
      x: offset,
      y: offset,
      duration: state === 'press' ? 0.08 : 0.2,
      ease: state === 'press' ? 'power2.out' : 'power3.out',
      overwrite: 'auto',
    });
  });

  // 押せなくなったら、位置を戻す(ホバー中に、無効になったとき)
  useEffect(() => {
    if (inactive && face.current) {
      gsap.killTweensOf(face.current);
      gsap.set(face.current, { x: 0, y: 0 });
      hovering.current = false;
    }
  }, [inactive]);

  const settle = (): void => moveTo(hovering.current ? 'hover' : 'rest');

  const handlers = inactive
    ? {}
    : {
        onPointerEnter: () => {
          hovering.current = true;
          moveTo('hover');
        },
        onPointerLeave: () => {
          hovering.current = false;
          moveTo('rest');
        },
        onPointerDown: () => moveTo('press'),
        onPointerUp: settle,
        onPointerCancel: settle,
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') moveTo('press');
        },
        onKeyUp: settle,
        onBlur: settle,
      };

  const className = [
    'btn',
    variant === 'default' ? '' : variant,
    large ? 'lg' : '',
    busy ? 'busy' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const setRoot = (element: HTMLElement | null): void => {
    root.current = element;
  };
  const content = (
    <span className="face" ref={face}>
      {children}
    </span>
  );

  // リンクは、押せないとき(`disabled`・`busy`)、ボタンにする(リンクには、無効の状態がないため)
  if (href !== undefined && !inactive) {
    if (download) {
      return (
        <a
          ref={setRoot}
          href={href}
          download
          className={className}
          aria-label={ariaLabel}
          {...handlers}
        >
          {content}
        </a>
      );
    }
    return (
      <Link
        ref={setRoot}
        href={href}
        className={className}
        aria-label={ariaLabel}
        {...handlers}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      ref={setRoot}
      type="button"
      className={className}
      disabled={inactive}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      {...handlers}
    >
      {content}
    </button>
  );
}
