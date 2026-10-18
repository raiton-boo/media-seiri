import type { EventStack } from '@file-seiri/ledger';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { AlbumMonthResponse } from '../../../src/api-types.ts';
import { eventLabel, parseTakenAt, stickerColor } from '../../lib/album';
import { useAlbumHref } from '../../lib/album-context';
import { EMPTY_FILTER } from '../../lib/album-filter';
import { formatCount } from '../../lib/format';
import { Button } from '../Button';
import { RevealDesk } from '../motion/Reveal';
import { PhotoImage } from './PhotoImage';
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
  const albumHref = useAlbumHref();
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

  const hasEvents = data.events.length > 0 || data.small.length > 0;
  if (!hasEvents && data.loose.count === 0) {
    return (
      <div className="card g">
        <div className="h2">この月の、できごとは、ありません</div>
      </div>
    );
  }
  const looseSection = data.loose.count > 0 ? <LooseMonth data={data} /> : null;
  if (!hasEvents) return looseSection;
  return (
    <>
      <RevealDesk className="desk deskgrid">
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
      {looseSection}
    </>
  );
}

/** できごとに入らない写真(日付が月までしか分からないものなど)。月の机は、できごとの束だけを置くため、ここに出す */
function LooseMonth({ data }: { data: AlbumMonthResponse }) {
  const albumHref = useAlbumHref();
  const month = `${data.year}-${String(data.month).padStart(2, '0')}`;
  return (
    <div
      className="card flex flex-col gap-4"
      style={{ marginTop: 24 }}
      data-motion="block"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="kicker">できごとに入らない写真</div>
          <div className="h2">{formatCount(data.loose.count)} 枚</div>
          <div className="mono" style={{ fontSize: 13 }}>
            日付が月までしか分からない写真など(撮影日が分かる写真から、できごとを作るため)
          </div>
        </div>
        <Button
          variant="y"
          href={albumHref({
            view: 'search',
            filter: { ...EMPTY_FILTER, dates: [month] },
          })}
        >
          この月の写真を、すべて一覧で →
        </Button>
      </div>
      <div className="sd-list">
        {data.loose.photos.map((photo) => (
          <Link
            key={photo.libraryFileId}
            className="sd-item"
            draggable={false}
            href={albumHref({
              view: 'photo',
              p: photo.libraryFileId,
              order: data.order,
            })}
          >
            <PhotoImage
              photo={photo}
              alt={photo.relPath.split('/').pop() ?? ''}
              allowOriginal={false}
            />
          </Link>
        ))}
      </div>
      {data.loose.count > data.loose.photos.length ? (
        <div className="mono" style={{ fontSize: 13 }}>
          先頭の {formatCount(data.loose.photos.length)}{' '}
          枚を出しています。残りは、「すべて一覧で」から。
        </div>
      ) : null}
    </div>
  );
}
