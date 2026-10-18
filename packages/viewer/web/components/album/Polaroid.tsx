import type { AlbumPhoto } from '@file-seiri/ledger';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { aspectClass, clockOf, rotationOf } from '../../lib/album';
import { thumbUrl } from '../../lib/api';

type Props = {
  photo: Pick<AlbumPhoto, 'thumbRelPath' | 'relPath' | 'width' | 'height'>;
  /** 机での位置の番号(傾きを決める) */
  index: number;
  /** 下の左右の文字(撮影時刻・印など) */
  caption?: [string, string];
  /** 2 列 × 2 行の、いちばん大きな 1 枚 */
  big?: boolean;
  /** 枠の比率を、写真ではなく、これで決める */
  ratio?: 'r43' | 'r34' | 'r11' | 'r32';
  /** 写真の上に重ねる付箋・テープ */
  children?: ReactNode;
  /** 押すと、移る場所(なければ、押せない) */
  href?: string;
  /** 位置・傾きなどの上書き(束の中の位置など) */
  style?: CSSProperties;
  /** 机の出現の動きの対象にする */
  motion?: boolean;
};

/**
 * 机に置く、ポラロイド(白い縁。下が広い)。傾きは、位置の番号から決める(毎回同じ)。
 * サムネイルがなければ、縞の下地に、ファイル名の札。
 */
export function Polaroid({
  photo,
  index,
  caption,
  big = false,
  ratio,
  children,
  href,
  style,
  motion = true,
}: Props) {
  const color = `c${(index % 7) + 1}`;
  const className = [
    'pol',
    big ? 'sp2 r43' : (ratio ?? aspectClass(photo.width, photo.height)),
  ].join(' ');
  const css = { '--rot': `${rotationOf(index)}deg`, ...style } as CSSProperties;
  const name = photo.relPath.split('/').pop() ?? photo.relPath;
  const inner = (
    <>
      {children}
      <div className={`ph ${color}`}>
        {photo.thumbRelPath ? (
          <img
            draggable={false}
            src={thumbUrl(photo.thumbRelPath)}
            alt={name}
            loading="lazy"
          />
        ) : (
          <div className="lb">{name} — サムネイルなし</div>
        )}
      </div>
      {caption ? (
        <div className="cp">
          <span>{caption[0]}</span>
          <span>{caption[1]}</span>
        </div>
      ) : null}
    </>
  );
  const data = motion ? { 'data-motion': 'pol' } : {};
  return href ? (
    <Link href={href} className={className} style={css} {...data}>
      {inner}
    </Link>
  ) : (
    <div className={className} style={css} {...data}>
      {inner}
    </div>
  );
}

/** 写真の下の文字: 撮影時刻(左)と、印(右: 動画の長さ・RAW・GPS) */
export const photoCaption = (
  photo: Pick<AlbumPhoto, 'takenAt' | 'kind' | 'hasGps' | 'durationSec'>,
  clip: (seconds: number) => string
): [string, string] => [
  clockOf(photo.takenAt),
  photo.kind === 'video' && photo.durationSec
    ? `▶ ${clip(photo.durationSec)}`
    : photo.kind === 'raw'
      ? 'RAW'
      : photo.hasGps
        ? 'GPS'
        : '',
];
