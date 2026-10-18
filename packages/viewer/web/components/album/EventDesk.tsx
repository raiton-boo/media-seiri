import type { CSSProperties } from 'react';
import type { AlbumEventResponse } from '../../../src/api-types.ts';
import { clockOf, formatClip } from '../../lib/album';
import { formatCount } from '../../lib/format';
import { RevealDesk } from '../motion/Reveal';
import { Polaroid, photoCaption } from './Polaroid';

/** テープ(一部の写真だけに貼る): 位置と傾きは、ワイヤーフレームの 4 通りを、順に使う */
const TAPES: CSSProperties[] = [
  { left: '42%', top: -14, transform: 'rotate(-4deg)' },
  { right: -18, top: 6, transform: 'rotate(38deg)' },
  { left: '30%', top: -14, transform: 'rotate(3deg)' },
  { left: -18, top: 12, transform: 'rotate(-40deg)' },
];

/** この番号の写真に、テープを貼るか(先頭と、ところどころ)。貼るなら、4 通りのどれか */
const tapeFor = (index: number): CSSProperties | undefined =>
  index === 0 || index % 3 === 1
    ? TAPES[Math.floor(index / 2) % TAPES.length]
    : undefined;

/**
 * できごとの机: 写真を、格子に、傾けて広げる(いちばん大きい 1 枚は、2 列 × 2 行)。
 * 代表の枚数(12 枚)だけ置き、「もっと広げる」で、増やす。
 */
export function EventDesk({
  data,
  title,
  onMore,
}: {
  data: AlbumEventResponse;
  title: string;
  onMore: () => void;
}) {
  const start = clockOf(data.startAt);
  const end = clockOf(data.endAt);
  const range = start && end ? `${start} → ${end}` : '';
  const note = [range, data.camera].filter(Boolean).join(' ／ ');
  const remaining = data.fileCount - data.photos.length - data.offset;

  return (
    <RevealDesk
      key={`${data.albumEventId}|${data.order}`}
      className="desk deskgrid"
    >
      <div
        className="stk"
        style={{
          left: 40,
          top: 26,
          transform: 'rotate(-2deg)',
          fontSize: 20,
          padding: '8px 18px',
          background: 'var(--y)',
          boxShadow: 'var(--sh)',
        }}
      >
        {title} ／ {formatCount(data.fileCount)} 枚
      </div>
      {note ? (
        <div
          className="stk"
          style={{
            right: 40,
            top: 30,
            transform: 'rotate(2deg)',
            background: 'var(--p)',
          }}
        >
          {note}
        </div>
      ) : null}
      {data.photos.map((photo, index) => {
        const tape = tapeFor(index);
        return (
          <Polaroid
            key={photo.libraryFileId}
            photo={photo}
            index={index}
            big={index === 0}
            caption={photoCaption(photo, formatClip)}
          >
            {tape ? <div className="tape" style={tape} /> : null}
          </Polaroid>
        );
      })}
      {remaining > 0 ? (
        <button
          type="button"
          className="stk"
          style={{
            right: 44,
            bottom: 22,
            transform: 'rotate(-2deg)',
            background: 'var(--b)',
            color: 'var(--paper)',
          }}
          onClick={onMore}
        >
          {formatCount(data.fileCount)} 枚のうち{' '}
          {formatCount(data.photos.length)} 枚 ／ もっと広げる ↓
        </button>
      ) : null}
    </RevealDesk>
  );
}
