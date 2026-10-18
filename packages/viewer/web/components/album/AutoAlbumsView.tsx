'use client';

import Link from 'next/link';
import { clockOf, eventTitle } from '../../lib/album';
import { AlbumFilterProvider, useAlbumHref } from '../../lib/album-context';
import { EMPTY_FILTER } from '../../lib/album-filter';
import { thumbUrl, useAutoAlbums } from '../../lib/api';
import { AUTO_ALBUM_BADGES, filterOfAutoAlbum } from '../../lib/auto-album';
import { formatCount } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealCards, RevealPage } from '../motion/Reveal';

/** できごとを、最初に出す数と、「もっと見る」で増やす数 */
const EVENT_STEP = 8;

function Cover({
  cover,
  index,
}: {
  cover: { thumbRelPath: string | null; relPath: string } | null;
  index: number;
}) {
  const name = cover?.relPath.split('/').pop() ?? '';
  return cover?.thumbRelPath ? (
    <img
      draggable={false}
      src={thumbUrl(cover.thumbRelPath)}
      alt={name}
      loading="lazy"
    />
  ) : (
    <div className="lb" data-index={index}>
      サムネイルなし
    </div>
  );
}

/**
 * 自動アルバム: 自動でまとめた「できごと」(新しい順)と、いろいろな切り口(動画・RAW・ライブフォト・場所・カメラ・日付フォールバック・日付なし)。
 * できごとを押すと、その机へ。切り口を押すと、その条件の「すべて」へ。自分で作るアルバムは、ない(読み取り専用)。
 */
export function AutoAlbumsView() {
  const url = useUrlState();
  const albumHref = useAlbumHref();
  const limit = Number(url.get('more')) || EVENT_STEP;
  const { data, isError } = useAutoAlbums(limit);

  if (isError) {
    return (
      <div className="page">
        <LoadError>自動アルバムを読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!data) return <ListSkeleton />;

  return (
    <AlbumFilterProvider filter={EMPTY_FILTER} drawer={false}>
      <RevealPage className="page">
        <div data-motion="title">
          <div className="kicker">AUTO ALBUMS</div>
          <h1 className="h1">自動アルバム</h1>
        </div>

        {data.eventTotal === 0 && data.albums.length === 0 ? (
          <div className="card g">
            <div className="h2">まだ、写真が、ありません</div>
          </div>
        ) : null}

        {data.eventTotal > 0 ? (
          <section className="flex flex-col gap-4">
            <div data-motion="block">
              <div className="mon" style={{ position: 'static' }}>
                できごと
                <small>
                  時刻の空きと場所から、自動でまとめた{' '}
                  {formatCount(data.eventTotal)} 件 ／ 新しい順
                </small>
              </div>
            </div>
            <RevealCards className="auto-grid grid gap-x-6 gap-y-8">
              {data.events.map((event, index) => {
                const start = clockOf(event.startAt);
                const end = clockOf(event.endAt);
                const range =
                  start && end && start !== end ? `${start}–${end}` : '';
                const stats = [range, event.camera]
                  .filter(Boolean)
                  .join(' ／ ');
                const badge = [
                  `${formatCount(event.fileCount)} 枚`,
                  event.gpsCount > 0 ? 'GPS' : '',
                  event.videoCount > 0 ? '▶' : '',
                ]
                  .filter(Boolean)
                  .join(' ／ ');
                return (
                  <Link
                    key={event.albumEventId}
                    href={albumHref({ view: 'event', e: event.albumEventId })}
                    className="pile"
                    style={{ display: 'block' }}
                    data-motion="card"
                  >
                    <div className={`ph c${(index % 7) + 1} a43`}>
                      <Cover cover={event.cover} index={index} />
                      <div className="bd">
                        <span>{badge}</span>
                      </div>
                    </div>
                    <div
                      style={{
                        background: 'var(--paper)',
                        border: 'var(--bd)',
                        borderTop: 0,
                        padding: '8px 12px',
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 16 }}>
                        {eventTitle(event.startAt)}
                      </div>
                      <div className="mono" style={{ fontSize: 12 }}>
                        {stats || ' '}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </RevealCards>
            {data.eventTotal > data.events.length ? (
              <div className="flex justify-center">
                <Button
                  onClick={() => url.set({ more: String(limit + EVENT_STEP) })}
                >
                  もっと見る({formatCount(data.eventTotal - data.events.length)}{' '}
                  件)
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {data.albums.length > 0 ? (
          <section className="flex flex-col gap-4">
            <div data-motion="block">
              <div className="mon p" style={{ position: 'static' }}>
                いろいろな切り口
                <small>自動アルバム(少数に絞る)</small>
              </div>
            </div>
            <RevealCards className="auto-grid grid gap-6">
              {data.albums.map((album, index) => {
                const badge = AUTO_ALBUM_BADGES[album.kind];
                return (
                  <Link
                    key={`${album.kind}-${album.title}`}
                    href={albumHref({
                      view: 'all',
                      filter: filterOfAutoAlbum(album),
                    })}
                    className="card s"
                    style={{
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      background: 'var(--paper)',
                    }}
                    data-motion="card"
                  >
                    <div
                      className={`ph c${(index % 7) + 1} a43`}
                      style={{
                        border: 0,
                        borderBottom: 'var(--bd)',
                        boxShadow: 'none',
                      }}
                    >
                      <Cover cover={album.cover} index={index} />
                      <div
                        className={`chip ${badge.tone}`}
                        style={{ position: 'absolute', left: 8, top: 8 }}
                      >
                        {badge.label}
                      </div>
                    </div>
                    <div
                      className="flex items-baseline justify-between"
                      style={{ padding: '10px 14px' }}
                    >
                      <span style={{ fontWeight: 900, fontSize: 16 }}>
                        {album.title}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 13, fontWeight: 700 }}
                      >
                        {formatCount(album.count)} {album.unit}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </RevealCards>
          </section>
        ) : null}

        <div className="note">
          アルバムは、自動で作ります(写真の顔認識や AI
          は使いません)。数は、少数に絞っています。自分で作るアルバム・お気に入りは、ありません(完全に読み取り専用)。
        </div>
      </RevealPage>
    </AlbumFilterProvider>
  );
}
