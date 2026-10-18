import Link from 'next/link';
import type { ReactNode } from 'react';

type Variant = 'default' | 'y' | 'ink';

/** 色の意味(design.md §2)で面の色を決める: 赤=エラー、オレンジ=注意、紫=日付なし、青=情報 */
type Tone = 'r' | 'o' | 'l' | 'b';

type Props = {
  children: ReactNode;
  variant?: Variant;
  /** 色の意味を持つ面にする(要チェックのカードなど)。`variant` より優先 */
  tone?: Tone;
  /** 横幅いっぱいにして、中身を左右に振り分ける(一覧の行・カードのように使うとき) */
  block?: boolean;
  /** 大きいボタン(影 6px)。主役の操作に使う */
  large?: boolean;
  /** 押せない。影を消して、灰色の平らな面になる */
  disabled?: boolean;
  /** 処理中。押せなくして、くるくる回る印を出す(カーソルは「待ち」) */
  loading?: boolean;
  /** ページ移動のリンクとして使う */
  href?: string;
  /** `href` が、ファイルの書き出し(CSV など)のとき。画面の移動にせず、ブラウザの保存にする */
  download?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
};

/** 処理中の印(arcana-members の LoadingMark と同じ形) */
function LoadingMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="spin"
      style={{ width: '1.1em', height: '1.1em', flex: 'none' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * ボタン。構造・見た目・動きは、すべて `neo.css` の `.btn`(arcana-members のボタンに合わせた CSS)。
 * 外側が影と当たり判定、内側 `.face` だけが、ホバーで浮き、押すと沈む。押せないときは、影が消えて、灰色の平らな面になる。
 * リンク(`href`)は、押せないとき、ボタンとして出す(リンクには、無効の状態がないため)。
 */
export function Button({
  children,
  variant = 'default',
  tone,
  block = false,
  large = false,
  disabled = false,
  loading = false,
  href,
  download = false,
  onClick,
  ariaLabel,
}: Props) {
  const inactive = disabled || loading;
  const className = [
    'btn',
    tone ? `t-${tone}` : variant === 'default' ? '' : variant,
    block ? 'block' : '',
    large ? 'lg' : '',
    loading ? 'loading' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = (
    <span className="face">
      {loading ? <LoadingMark /> : null}
      {block ? children : <span className="blabel">{children}</span>}
    </span>
  );

  if (href !== undefined && !inactive) {
    return download ? (
      <a href={href} download className={className} aria-label={ariaLabel}>
        {content}
      </a>
    ) : (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={inactive}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
