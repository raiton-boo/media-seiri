'use client';

import { useMemo } from 'react';
import { AlbumFilterProvider } from '../../lib/album-context';
import {
  thumbUrl,
  useCalendar,
  useCalendarDay,
  useSearchPhotos,
} from '../../lib/api';
import {
  type CalendarCell,
  longDay,
  monthCells,
  shortDay,
  topDays,
} from '../../lib/calendar';
import { formatCount } from '../../lib/format';
import { useAlbumFilterState } from '../../lib/use-album-filter';
import { Button } from '../Button';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';
import { FilterBar } from './FilterBar';
import { FilterDrawer } from './FilterDrawer';
import { SearchBox } from './SearchBox';

/** 選んだ日の、小さな写真の数 */
const DAY_THUMBS = 6;
/** 「この年で多かった日」の件数 */
const TOP_DAYS = 3;

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** 日付の欄で、月ごとの枚数(日まで分かるものだけ) */
const monthTotal = (
  days: readonly { date: string; count: number }[],
  month: number
): number =>
  days
    .filter((day) => Number(day.date.slice(5, 7)) === month)
    .reduce((sum, day) => sum + day.count, 0);

/**
 * カレンダー: 年を選ぶと、12 か月のマスに、日ごとの枚数が濃さ(5 段階)で出る。
 * マスを選ぶと、右に、その日のまとめと写真。日付が不明なものは、載らない。絞り込みの条件が効く。
 */
export function CalendarView() {
  const state = useAlbumFilterState();
  const { url, filter, drawer, albumHref } = state;
  const yearParam = Number(url.get('y')) || undefined;
  const dateParam = url.get('d');

  const calendar = useCalendar(yearParam, filter);
  const days = calendar.data?.days ?? [];
  const year = calendar.data?.year ?? undefined;

  const counts = useMemo(
    () => new Map(days.map((day) => [day.date, day.count])),
    [days]
  );
  const max = days.reduce((best, day) => Math.max(best, day.count), 0);
  const top = useMemo(() => topDays(days, TOP_DAYS), [days]);
  // 日を選んでいなければ(または、この年の日でなければ)、いちばん多かった日
  const selected =
    dateParam && counts.has(dateParam) ? dateParam : top[0]?.date;

  const summary = useCalendarDay(selected, filter);
  const photos = useSearchPhotos(
    'old',
    { ...filter, dates: selected ? [selected] : [] },
    DAY_THUMBS,
    selected !== undefined
  );

  if (calendar.isError) {
    return (
      <div className="page">
        <LoadError>カレンダーを読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!calendar.data) return <ListSkeleton />;

  const dayFilter = selected ? { ...filter, dates: [selected] } : filter;

  return (
    <AlbumFilterProvider filter={filter} drawer={drawer}>
      <RevealPage className="page">
        <div
          className="flex flex-wrap items-end justify-between gap-6"
          data-motion="title"
        >
          <div>
            <div className="kicker">CALENDAR</div>
            <h1 className="h1">
              カレンダー
              {year === undefined ? null : (
                <span className="h1-sub"> - {year}年</span>
              )}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button href={albumHref()}>← アルバムへ</Button>
            {calendar.data.years.length > 0 ? (
              <div className="seg y">
                {calendar.data.years.map((item) => (
                  <button
                    key={item.year}
                    type="button"
                    className={item.year === year ? 'on' : undefined}
                    aria-pressed={item.year === year}
                    onClick={() =>
                      url.set({ y: String(item.year), d: undefined })
                    }
                  >
                    {item.year}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div data-motion="block">
          <SearchBox
            filter={filter}
            onPick={state.pickSearch}
            onRemove={state.removeSearch}
          />
        </div>

        <FilterBar
          filter={filter}
          volumeLabels={state.volumeLabels}
          drawerOpen={drawer}
          onToggleDrawer={state.toggleDrawer}
          onChange={state.changeFilter}
        />

        {year === undefined ? (
          <div className="card">
            <div className="h2">
              {state.hasSearch || filter.kinds.length > 0
                ? '条件に合う、日付のわかる写真は、ありません'
                : '日付のわかる写真が、まだありません'}
            </div>
          </div>
        ) : (
          <div
            className="grid items-start gap-6"
            style={{
              gridTemplateColumns: drawer
                ? 'minmax(0,1fr) 340px'
                : 'minmax(0,9fr) minmax(0,3fr)',
            }}
          >
            <div className="card" style={{ padding: 22 }} data-motion="block">
              <div
                className="grid gap-6"
                style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
              >
                {MONTHS.map((month) => (
                  <div key={month}>
                    <div
                      className="flex items-baseline justify-between"
                      style={{
                        borderBottom: '3px solid var(--ink)',
                        paddingBottom: 4,
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--disp)', fontSize: 24 }}>
                        {String(month).padStart(2, '0')}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 12, fontWeight: 700 }}
                      >
                        {formatCount(monthTotal(days, month))} 枚
                      </span>
                    </div>
                    <div
                      className="grid gap-1"
                      style={{
                        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                      }}
                    >
                      {monthCells(year, month, counts, max).map(
                        (cell: CalendarCell, index) =>
                          cell.kind === 'blank' ? (
                            // 月の最初の空き。並びは変わらない
                            // biome-ignore lint/suspicious/noArrayIndexKey: 固定の並び
                            <div key={`b${index}`} className="cd e" />
                          ) : cell.count === 0 ? (
                            <div
                              key={cell.date}
                              className="cd off"
                              title="この日の写真は、ありません"
                            >
                              {cell.day}
                            </div>
                          ) : (
                            <button
                              key={cell.date}
                              type="button"
                              className={`cd h${cell.level}${cell.date === selected ? ' sel' : ''}`}
                              style={{ textAlign: 'left' }}
                              aria-pressed={cell.date === selected}
                              aria-label={`${month}月${cell.day}日 ${cell.count} 枚`}
                              onClick={() => url.set({ d: cell.date })}
                            >
                              {cell.day}
                            </button>
                          )
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mono flex items-center gap-2"
                style={{ fontSize: 12, fontWeight: 700, paddingTop: 18 }}
              >
                <span>少</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <i
                    key={level}
                    className={`cd${level > 0 ? ` h${level}` : ' off'}`}
                    style={{ width: 20, display: 'block', cursor: 'default' }}
                  />
                ))}
                <span>多</span>
                <span style={{ marginLeft: 'auto' }}>
                  マスを選ぶと、その日の写真へ
                </span>
              </div>
            </div>

            <aside className="flex flex-col gap-4">
              {drawer ? (
                <FilterDrawer filter={filter} onChange={state.changeFilter} />
              ) : null}
              {selected ? (
                <div className="card y flex flex-col gap-3" data-motion="block">
                  <div className="kicker">選んだ日</div>
                  <div className="h2">{longDay(selected)}</div>
                  {summary.data ? (
                    <div
                      className="mono"
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {formatCount(summary.data.count)} 枚
                      {summary.data.firstClock && summary.data.lastClock
                        ? ` ／ ${summary.data.firstClock}–${summary.data.lastClock}`
                        : ''}
                      {summary.data.gpsCount > 0
                        ? ` ／ GPS ${formatCount(summary.data.gpsCount)}`
                        : ''}
                    </div>
                  ) : null}
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
                  >
                    {(photos.data?.photos ?? []).map((photo, index) => (
                      <a
                        key={photo.libraryFileId}
                        className={`ph c${(index % 7) + 1}`}
                        style={{ aspectRatio: '1', display: 'block' }}
                        href={albumHref({
                          view: 'photo',
                          p: photo.libraryFileId,
                          filter: dayFilter,
                          order: 'old',
                        })}
                      >
                        {photo.thumbRelPath ? (
                          <img
                            draggable={false}
                            src={thumbUrl(photo.thumbRelPath)}
                            alt={photo.relPath.split('/').pop() ?? ''}
                          />
                        ) : null}
                      </a>
                    ))}
                  </div>
                  <Button
                    block
                    href={albumHref({
                      view: 'search',
                      filter: dayFilter,
                      order: 'old',
                    })}
                  >
                    この日の写真を机に広げる →
                  </Button>
                  <Button
                    block
                    variant="ink"
                    href={albumHref({
                      view: 'slide',
                      filter: dayFilter,
                      order: 'old',
                    })}
                  >
                    ▶ スライドショー
                  </Button>
                </div>
              ) : null}
              {top.length > 0 ? (
                <div className="card p" data-motion="block">
                  <div className="kicker">この年で多かった日</div>
                  <div
                    className="flex flex-col gap-1"
                    style={{ paddingTop: 6 }}
                  >
                    {top.map((day) => (
                      <button
                        key={day.date}
                        type="button"
                        className="mono"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          fontSize: 13,
                          textAlign: 'left',
                          cursor: 'pointer',
                          textDecoration:
                            day.date === selected ? 'underline' : undefined,
                        }}
                        onClick={() => url.set({ d: day.date })}
                      >
                        <b>{shortDay(day.date)}</b> {formatCount(day.count)} 枚
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="note">
                濃い日は、写真の多い日。日付が不明なもの(年・月だけのものを含む)は、カレンダーに載りません。
              </div>
            </aside>
          </div>
        )}
      </RevealPage>
    </AlbumFilterProvider>
  );
}
