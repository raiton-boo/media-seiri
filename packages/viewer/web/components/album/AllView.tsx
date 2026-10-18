'use client';

import type { AlbumPhoto, AlbumSection } from '@file-seiri/ledger';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAlbumHref } from '../../lib/album-context';
import type { FilterState } from '../../lib/album-filter';
import {
  type AlbumOrderParam,
  thumbUrl,
  useSectionPhotos,
} from '../../lib/api';
import { formatCount } from '../../lib/format';
import { layoutRows } from '../../lib/layout-rows';

export type AllLayout = 'masonry' | 'rows';

/** 行ぞろえの、目標の高さと、写真の間 */
const ROW_HEIGHT = 200;
const GAP = 12;
/** 区画の見出しの高さ(見出し + 余白) */
const HEAD = 64;

const sectionKey = (section: AlbumSection): string =>
  `${section.year}-${section.month}`;

const sectionTitle = (section: AlbumSection): string =>
  section.year === 0
    ? '日付なし'
    : section.month === 0
      ? `${section.year}年 月不明`
      : `${section.year}年${section.month}月`;

const ratioOf = (photo: AlbumPhoto): number =>
  photo.width && photo.height ? photo.width / photo.height : 4 / 3;

function Tile({
  photo,
  index,
  order,
}: {
  photo: AlbumPhoto;
  index: number;
  order: AlbumOrderParam;
}) {
  const albumHref = useAlbumHref();
  const name = photo.relPath.split('/').pop() ?? photo.relPath;
  return (
    <Link
      href={albumHref({ view: 'photo', p: photo.libraryFileId, order })}
      className={`ph c${(index % 7) + 1}`}
      style={{ aspectRatio: String(ratioOf(photo)), display: 'block' }}
    >
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
    </Link>
  );
}

function Rows({
  photos,
  width,
  order,
}: {
  photos: AlbumPhoto[];
  width: number;
  order: AlbumOrderParam;
}) {
  const rows = useMemo(
    () =>
      layoutRows(
        photos.map((p) => ({ ratio: ratioOf(p) })),
        width,
        ROW_HEIGHT,
        GAP
      ),
    [photos, width]
  );
  return (
    <div className="flex flex-col" style={{ gap: GAP }}>
      {rows.map((row) => (
        <div key={row.start} className="jr">
          {photos.slice(row.start, row.end).map((photo, i) => (
            <div
              key={photo.libraryFileId}
              style={{ width: ratioOf(photo) * row.height, flex: '0 0 auto' }}
            >
              <Tile photo={photo} index={row.start + i} order={order} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 1 区画(年・月): 見出しは、スクロールの間、上に残る。写真は、近づいたときに読む */
function Section({
  section,
  order,
  layout,
  width,
  filter,
  active,
}: {
  section: AlbumSection;
  order: AlbumOrderParam;
  filter: FilterState;
  layout: AllLayout;
  width: number;
  active: boolean;
}) {
  const { data, isError } = useSectionPhotos(
    section.year,
    section.month,
    order,
    filter,
    active
  );
  return (
    <section style={{ paddingBottom: 36 }}>
      <div className="mon">
        {sectionTitle(section)}
        <small>{formatCount(section.count)} 枚</small>
      </div>
      <div style={{ marginTop: 16 }}>
        {isError ? (
          <div className="note">この区画を読み込めませんでした。</div>
        ) : data ? (
          layout === 'rows' ? (
            <Rows photos={data.photos} width={width} order={order} />
          ) : (
            <div className="msn">
              {data.photos.map((photo, i) => (
                <Tile
                  key={photo.libraryFileId}
                  photo={photo}
                  index={i}
                  order={order}
                />
              ))}
            </div>
          )
        ) : (
          <div
            className="sk"
            style={{ height: estimateBody(section, layout, width) }}
            role="status"
            aria-label="読み込み中"
          />
        )}
      </div>
    </section>
  );
}

/** 写真を読む前の、本体の高さの見込み(スクロールの位置が、飛びすぎないように) */
const estimateBody = (
  section: AlbumSection,
  layout: AllLayout,
  width: number
): number => {
  if (layout === 'rows') {
    const perRow = Math.max(1, Math.floor(width / (ROW_HEIGHT * 1.4 + GAP)));
    return Math.ceil(section.count / perRow) * (ROW_HEIGHT + GAP);
  }
  return Math.ceil(section.count / 5) * 190;
};

/**
 * 「すべて」: 年月の区画を縦に並べ、画面に近い区画だけ描く(仮想スクロール)。右に、年の目盛り。
 * 配置は、マソンリー(既定)か行ぞろえ。
 */
export function AllView({
  sections,
  order,
  layout,
  filter,
}: {
  sections: AlbumSection[];
  order: AlbumOrderParam;
  filter: FilterState;
  layout: AllLayout;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: sections.length,
    estimateSize: (index) => {
      const section = sections[index];
      return section
        ? HEAD + estimateBody(section, layout, width || 1000)
        : 400;
    },
    overscan: 2,
    scrollMargin: list.current?.offsetTop ?? 0,
  });
  // 並び・配置が変わると、高さの見込みが変わる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依存の変化で、測り直す
  useEffect(() => {
    virtualizer.measure();
  }, [layout, order, width, virtualizer]);

  const items = virtualizer.getVirtualItems();
  // いま画面の上にある区画(先読みの分は、除く)
  const topItem =
    items.find((item) => item.end > (virtualizer.scrollOffset ?? 0)) ??
    items[0];
  const topSection = sections[topItem?.index ?? 0];
  const years = useMemo(() => {
    const map = new Map<number, { count: number; first: number }>();
    sections.forEach((section, index) => {
      const entry = map.get(section.year);
      if (entry) entry.count += section.count;
      else map.set(section.year, { count: section.count, first: index });
    });
    return [...map.entries()];
  }, [sections]);

  return (
    <div className="flex items-start gap-6">
      <div ref={list} className="min-w-0 flex-1">
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {items.map((item) => {
            const section = sections[item.index];
            if (!section) return null;
            return (
              <div
                key={sectionKey(section)}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  // transform ではなく top で置く(transform だと、見出しの sticky が、位置を取り違える)
                  top: item.start - virtualizer.options.scrollMargin,
                  left: 0,
                  width: '100%',
                }}
              >
                <Section
                  section={section}
                  order={order}
                  filter={filter}
                  layout={layout}
                  width={width}
                  active
                />
              </div>
            );
          })}
        </div>
      </div>
      <nav className="big-scr" aria-label="年へ移動">
        {years.map(([year, entry]) => (
          <button
            key={year}
            type="button"
            className={`yb${topSection?.year === year ? ' on' : ''}`}
            onClick={() =>
              virtualizer.scrollToIndex(entry.first, { align: 'start' })
            }
          >
            {year === 0 ? '不明' : year}
            <small>{formatCount(entry.count)}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
