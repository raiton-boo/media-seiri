import type { EventStack } from '@file-seiri/ledger';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { AlbumMonthResponse } from '../../../src/api-types.ts';
import { eventLabel, parseTakenAt, stickerColor } from '../../lib/album';
import { albumHref } from '../../lib/album-url';
import { formatCount } from '../../lib/format';
import { RevealDesk } from '../motion/Reveal';
import { Polaroid } from './Polaroid';

/** 束の中の、後ろ・中・前の、位置と傾き(ワイヤーフレームどおり) */
const LAYERS: CSSProperties[] = [
  { left: '16%', top: '12%', ['--rot' as string]: '4deg' },
  { left: '8%', top: '6%', ['--rot' as string]: '-3deg' },
];

function Stack({
  stack,
  index,
  order,
  year,
  month,
}: {
  stack: EventStack;
  index: number;
  order: AlbumMonthResponse['order'];
  year: number;
  month: number;
}) {
  const parts = parseTakenAt(stack.startAt);
  // 後ろから前へ(先頭の写真が、いちばん手前)。写真が足りなければ、層を減らす
  const photos = stack.photos.slice(0, 3);
  const back = photos.slice(1).reverse();
  const front = photos[0];
  return (
    <Link
      href={albumHref({
        view: 'event',
        e: stack.albumEventId,
        order,
        y: year,
        m: month,
      })}
      className="stack"
      data-motion="pol"
    >
      {back.map((photo, layer) => (
        <Polaroid
          key={photo.libraryFileId}
          photo={photo}
          index={index + layer + 1}
          motion={false}
          style={LAYERS[layer + (2 - back.length)]}
        />
      ))}
      {front ? (
        <Polaroid
          photo={front}
          index={index}
          motion={false}
          style={{ left: 0, top: 0 }}
          caption={[
            parts ? `${parts.month}/${parts.day}` : '',
            `${formatCount(stack.fileCount)} 枚`,
          ]}
        />
      ) : null}
      <div
        className="stk"
        style={{
          left: -8,
          bottom: 4,
          background: stickerColor(index),
          transform: 'rotate(-3deg)',
        }}
      >
        {eventLabel(stack.startAt)}
      </div>
    </Link>
  );
}

/**
 * 月の机: できごとを、重ねたポラロイドの束で置く(束どうしは、重ならない)。
 * 3 枚未満の「小さなできごと」は、まとめて、付箋で、出し入れする。
 */
export function MonthDesk({
  data,
  showSmall,
  onToggleSmall,
}: {
  data: AlbumMonthResponse;
  showSmall: boolean;
  onToggleSmall: () => void;
}) {
  const smallFiles = data.small.reduce((sum, item) => sum + item.fileCount, 0);
  const stacks = showSmall ? [...data.events, ...data.small] : data.events;

  if (data.events.length === 0 && data.small.length === 0) {
    return (
      <div className="card g">
        <div className="h2">この月の、できごとは、ありません</div>
      </div>
    );
  }
  return (
    <RevealDesk
      key={`${data.year}|${data.month}|${data.order}|${showSmall}`}
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
          boxShadow: 'var(--sh)',
        }}
      >
        {data.year} 年 {data.month} 月 ／ {formatCount(data.total)} 枚
      </div>
      {data.small.length > 0 ? (
        <button
          type="button"
          className="stk"
          style={{
            right: 40,
            top: 26,
            transform: 'rotate(2deg)',
            background: showSmall ? 'var(--y)' : 'var(--paper)',
          }}
          aria-pressed={showSmall}
          onClick={onToggleSmall}
        >
          {showSmall ? '✓ ' : ''}ほか 小さなできごと{' '}
          {formatCount(data.small.length)} 件 ／ {formatCount(smallFiles)} 枚{' '}
          {showSmall ? '(隠す)' : '→'}
        </button>
      ) : null}
      {stacks.map((stack, index) => (
        <Stack
          key={stack.albumEventId}
          stack={stack}
          index={index}
          order={data.order}
          year={data.year}
          month={data.month}
        />
      ))}
      <div
        className="stk"
        style={{
          right: 44,
          bottom: 22,
          transform: 'rotate(-2deg)',
          background: 'var(--b)',
        }}
      >
        束を押すと、できごとの机へ(写真を広げる)
      </div>
    </RevealDesk>
  );
}
