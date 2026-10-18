'use client';

import type { MonthSummary } from '@file-seiri/ledger';
import Link from 'next/link';
import { useRef } from 'react';
import type { AlbumOverviewResponse } from '../../../src/api-types.ts';
import { albumHref } from '../../lib/album-url';
import type { AlbumOrderParam } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { SwapLabel } from '../motion/SwapLabel';
import { type TileLayout, useRulerMotion } from './useRulerMotion';

type Props = {
  overview: AlbumOverviewResponse;
  order: AlbumOrderParam;
  /** いまのズーム */
  zoom: 'year' | 'month' | 'event';
  /** いま開いている年と、その年の 12 か月(`order` の並び) */
  year: number;
  months: MonthSummary[];
  /** 月・できごとのとき、いまの月 */
  month?: number;
  /** 「できごと」の切り替えで、行く先(なければ、押せない) */
  eventHref?: string;
  /** 並び順の切り替え(いまの画面の URL で、並び順だけ変える) */
  onToggleOrder: () => void;
};

/** 月の棒の高さ(px)の範囲 */
const BAR_MIN = 8;
const BAR_MAX = 40;

/**
 * 時間の定規: 年の札が、枚数に比例した幅で並ぶ。いまの年は、月の棒グラフに開き、**つまみ**が、位置を示す。
 * 年・月は、押すと、その机へ。右に、並び順(新しい順 / 古い順)。「すべて」は、まだ作っていない。
 */
export function TimeRuler({
  overview,
  order,
  zoom,
  year,
  months,
  month,
  eventHref,
  onToggleOrder,
}: Props) {
  const maxCount = Math.max(1, ...months.map((item) => item.count));
  const latestMonth =
    [...months]
      .filter((item) => item.count > 0)
      .sort((a, b) => b.month - a.month)[0]?.month ?? 1;
  const currentMonth = month ?? latestMonth;
  const markerIndex =
    zoom === 'year'
      ? -1
      : months.findIndex((item) => item.month === currentMonth);
  const markerLeft = zoom === 'year' ? 50 : ((markerIndex + 0.5) / 12) * 100;
  const total = Math.max(1, overview.total);
  const root = useRef<HTMLDivElement>(null);

  // 年の札の幅(枚数に比例。いまの年は、月の棒が入る広さ)。動きのために、札ごとに、まとめておく
  const tiles: TileLayout[] = overview.years.map((item) => {
    const grow = Math.max(0.6, (item.count / total) * 10);
    return item.year === year
      ? { year: item.year, grow: Math.max(grow, 3), basis: 240 }
      : { year: item.year, grow, basis: 72 };
  });
  useRulerMotion(root, year, tiles, markerLeft);

  return (
    <div className="ruler" ref={root}>
      <div className="flex flex-col justify-center gap-2 pr-2.5 pl-1">
        <div className="seg y">
          <Link
            href={albumHref({ view: 'year', y: year, order })}
            className={zoom === 'year' ? 'on' : undefined}
          >
            年
          </Link>
          <Link
            href={albumHref({ view: 'month', y: year, m: currentMonth, order })}
            className={zoom === 'month' ? 'on' : undefined}
          >
            月
          </Link>
          {eventHref ? (
            <Link
              href={eventHref}
              className={zoom === 'event' ? 'on' : undefined}
            >
              できごと
            </Link>
          ) : (
            <span className="off" aria-disabled="true">
              できごと
            </span>
          )}
          <span className="off" aria-disabled="true" title="まだ作っていません">
            すべて
          </span>
        </div>
      </div>

      {overview.years.map((item) => {
        const tile = tiles.find((candidate) => candidate.year === item.year);
        if (!tile) return null;
        if (item.year !== year) {
          return (
            <Link
              key={item.year}
              href={albumHref({ view: 'year', y: item.year, order })}
              className="yt"
              data-year={item.year}
              style={{
                flex: `${tile.grow} 1 ${tile.basis}px`,
                overflow: 'hidden',
              }}
            >
              <span>{item.year}</span>
              <small>{formatCount(item.count)}</small>
            </Link>
          );
        }
        return (
          <div
            key={item.year}
            className="yt on"
            data-year={item.year}
            style={{ flex: `${tile.grow} 1 ${tile.basis}px`, paddingTop: 18 }}
          >
            <div className="flex items-baseline justify-between">
              <span>{item.year}</span>
              <small>{formatCount(item.count)} 枚</small>
            </div>
            <div className="mbars">
              <div className="thumb" style={{ left: `${markerLeft}%` }}>
                ▼ {zoom === 'year' ? '年' : `${currentMonth}月`}
              </div>
              {months.map((entry) => (
                <Link
                  key={entry.month}
                  href={albumHref({
                    view: 'month',
                    y: year,
                    m: entry.month,
                    order,
                  })}
                  className="mbar"
                  aria-label={`${entry.month}月 ${entry.count} 枚`}
                >
                  <i
                    className={
                      zoom !== 'year' && entry.month === currentMonth
                        ? 'on'
                        : undefined
                    }
                    style={{
                      height: `${entry.count === 0 ? 4 : Math.max(BAR_MIN, Math.round((entry.count / maxCount) * BAR_MAX))}px`,
                    }}
                  />
                </Link>
              ))}
            </div>
            <div
              className="mono flex justify-between"
              style={{ fontSize: 12, fontWeight: 700 }}
              aria-hidden="true"
            >
              {months.map((entry) => (
                <span key={entry.month}>{entry.month}</span>
              ))}
            </div>
          </div>
        );
      })}

      {overview.undated > 0 ? (
        <span
          className="yt off"
          style={{ flex: '0.5 1 72px', background: 'var(--r)' }}
          title="日付が不明(まだ、見る画面がありません)"
        >
          <span style={{ fontSize: 13 }}>不明</span>
          <small>{formatCount(overview.undated)}</small>
        </span>
      ) : null}

      <div className="flex flex-col justify-center gap-2 pr-1 pl-2.5">
        <button
          type="button"
          className="chip on"
          onClick={onToggleOrder}
          aria-label="並び順を切り替える"
        >
          <SwapLabel
            active={order === 'old'}
            label="新しい順 ▾"
            activeLabel="古い順 ▾"
          />
        </button>
      </div>
    </div>
  );
}
