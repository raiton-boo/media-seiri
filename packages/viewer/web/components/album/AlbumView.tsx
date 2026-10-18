'use client';

import Link from 'next/link';
import { eventTitle } from '../../lib/album';
import { AlbumFilterProvider } from '../../lib/album-context';
import {
  countSearch,
  type FilterState,
  filterParams,
  isFiltered,
  readFilter,
} from '../../lib/album-filter';
import {
  type AlbumLocation,
  albumHref as buildHref,
} from '../../lib/album-url';
import {
  useAlbumEvent,
  useAlbumFilters,
  useAlbumMonth,
  useAlbumOverview,
  useAlbumSections,
  useAlbumYear,
  useSearchPhotos,
} from '../../lib/api';
import { formatCount } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { FilterChip } from '../FilterChip';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';
import { AllView } from './AllView';
import { CalendarView } from './CalendarView';
import { EventDesk } from './EventDesk';
import { FilterBar } from './FilterBar';
import { FilterDrawer } from './FilterDrawer';
import { Memories } from './Memories';
import { MonthDesk } from './MonthDesk';
import { PhotoViewer } from './PhotoViewer';
import { SearchBox } from './SearchBox';
import { SearchDesk } from './SearchDesk';
import { Slideshow } from './Slideshow';
import { TimeRuler } from './TimeRuler';
import { YearDesk } from './YearDesk';

/** できごとの机で、最初に広げる枚数と、「もっと広げる」で増やす枚数 */
const EVENT_STEP = 12;
/** 検索結果の机で、最初に広げる枚数と、「もっと広げる」で増やす枚数 */
const SEARCH_STEP = 12;

const toInt = (value: string | undefined): number | undefined => {
  const number = Number(value);
  return value !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined;
};

/**
 * アルバム: 入口(最新の年の机)→ 年 → 月 → できごと、の机。
 * 場所は、URL のクエリで表す(`view`・`y`・`m`・`e`・`order`・`small`・`more`)。`view` がなければ、入口。
 */
function AlbumBrowser() {
  const url = useUrlState();
  const view = (['year', 'month', 'event', 'all', 'search'] as const).find(
    (candidate) => candidate === url.get('view')
  );
  const order = url.get('order') === 'old' ? 'old' : 'new';
  const yearParam = toInt(url.get('y'));
  const monthParam = toInt(url.get('m'));
  const eventId = view === 'event' ? toInt(url.get('e')) : undefined;
  const more = toInt(url.get('more')) ?? EVENT_STEP;
  const showSmall = url.get('small') === '1';

  const filter = readFilter(url.getAll);
  const filtered = isFiltered(filter);
  const drawer = url.get('drawer') === '1';
  // 移っても、条件と引き出しの開閉を引き継ぐ
  const albumHref = (location: AlbumLocation = {}): string =>
    buildHref({ filter, drawer, ...location });
  // 条件を変えたら、「もっと広げる」は、最初に戻す
  const changeFilter = (next: FilterState): void =>
    url.set({ ...filterParams(next), more: undefined });
  const facets = useAlbumFilters(filter, drawer || filter.volumes.length > 0);
  const volumeLabels = new Map(
    (facets.data?.volumes ?? []).map((volume) => [
      String(volume.volumeId),
      volume.label ?? `ドライブ #${volume.volumeId}`,
    ])
  );
  const layout = url.get('layout') === 'rows' ? 'rows' : 'masonry';

  const overview = useAlbumOverview(order, filter);
  const allSections = useAlbumSections(order, filter);
  const searchResult = useSearchPhotos(
    order,
    filter,
    toInt(url.get('more')) ?? SEARCH_STEP,
    view === 'search'
  );
  const event = useAlbumEvent(eventId, order, more, filter);
  const eventStart = event.data?.startAt;
  // いま開いている年(定規の開く年): できごとなら、その年。入口は、最新の年
  const eventYear = eventStart ? Number(eventStart.slice(0, 4)) : undefined;
  const year =
    view === 'event'
      ? eventYear
      : (yearParam ?? overview.data?.latestYear ?? undefined);
  const yearData = useAlbumYear(year, order, filter);
  const monthData = useAlbumMonth(
    view === 'month' ? year : undefined,
    view === 'month' ? monthParam : undefined,
    order,
    filter
  );

  const failed =
    overview.isError ||
    (view === 'all' && allSections.isError) ||
    (view === 'search' && searchResult.isError) ||
    yearData.isError ||
    monthData.isError ||
    event.isError;
  if (failed) {
    return (
      <div className="page">
        <LoadError>アルバムを読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!overview.data) return <ListSkeleton />;
  if (overview.data.total === 0) {
    return (
      <div className="page">
        {filtered ? (
          <>
            <h1 className="h1">アルバム</h1>
            <FilterBar
              filter={filter}
              volumeLabels={volumeLabels}
              drawerOpen={drawer}
              onToggleDrawer={() =>
                url.set({ drawer: drawer ? undefined : '1' })
              }
              onChange={changeFilter}
            />
            <div className="card">
              <div className="h2">条件に合う写真は、ありません</div>
            </div>
          </>
        ) : (
          <div className="card g">
            <div className="h2">まだ、写真が、ありません</div>
          </div>
        )}
      </div>
    );
  }
  if (year === undefined || !yearData.data) return <ListSkeleton />;

  const searching = view === 'search';
  const zoom = view === 'search' ? 'year' : (view ?? 'year');
  const eventMonth = eventStart ? Number(eventStart.slice(5, 7)) : undefined;
  // 定規には、手元にあるデータの年・月を渡す(新しいデータが届くまで、前のデータを見せ続けるため。URL の年・月と、棒のデータが、ずれないように)
  const rulerYear = yearData.data.year;
  const month =
    view === 'month' ? (monthData.data?.month ?? monthParam) : eventMonth;
  const monthEvents = monthData.data;
  const firstEventId =
    monthEvents?.events[0]?.albumEventId ?? monthEvents?.small[0]?.albumEventId;
  const eventHref =
    view === 'event'
      ? albumHref({ view: 'event', e: eventId, order })
      : firstEventId
        ? albumHref({ view: 'event', e: firstEventId, order })
        : undefined;

  // 並び順の切り替え: 新しい順(既定)は、URL から消す
  const toggleOrder = (): void =>
    url.set({ order: order === 'new' ? 'old' : undefined });

  const entrance = view === undefined;
  const heading =
    view === 'search'
      ? searchResult.data
        ? `見つけた、${formatCount(searchResult.data.total)} 枚。`
        : '検索結果'
      : view === 'all'
        ? 'すべて'
        : view === 'event' && eventStart
          ? eventTitle(eventStart)
          : view === 'month' && monthParam
            ? `${year}年${monthParam}月`
            : `${year}年`;
  const kicker =
    view === 'search'
      ? `SEARCH / ${order === 'new' ? '新しい順' : '古い順'}`
      : view === 'all'
        ? `ALL / ${order === 'new' ? '新しい順' : '古い順'}`
        : view === 'event'
          ? 'EVENT / 机の上に広げる'
          : view === 'month'
            ? 'MONTH / できごとの束'
            : entrance
              ? `入口 / 最新の年の机 / ${order === 'new' ? '新しい順' : '古い順'}`
              : `YEAR / ${order === 'new' ? '新しい順' : '古い順'}`;

  return (
    <AlbumFilterProvider filter={filter} drawer={drawer}>
      <RevealPage className="page">
        <div
          className="flex flex-wrap items-end justify-between gap-6"
          data-motion="title"
        >
          <div>
            {view && view !== 'all' && view !== 'search' ? (
              <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                <Link
                  href={albumHref({ order })}
                  style={{ textDecoration: 'underline' }}
                >
                  アルバム
                </Link>
                {' ▸ '}
                <Link
                  href={albumHref({ view: 'year', y: year, order })}
                  style={
                    view === 'year'
                      ? undefined
                      : { textDecoration: 'underline' }
                  }
                >
                  {year}年
                </Link>
                {view !== 'year' && month ? (
                  <>
                    {' ▸ '}
                    <Link
                      href={albumHref({
                        view: 'month',
                        y: year,
                        m: month,
                        order,
                      })}
                      style={
                        view === 'month'
                          ? undefined
                          : { textDecoration: 'underline' }
                      }
                    >
                      {month}月
                    </Link>
                  </>
                ) : null}
                {view === 'event' ? ' ▸ できごと' : ''}
              </div>
            ) : (
              <div className="kicker">{kicker}</div>
            )}
            <h1
              className="h1"
              style={
                view && view !== 'all' && view !== 'search'
                  ? { paddingTop: 8 }
                  : undefined
              }
            >
              {heading}{' '}
              {entrance && year === overview.data.latestYear ? (
                <span
                  className="chip y"
                  style={{ fontSize: 14, verticalAlign: 'middle' }}
                >
                  最新
                </span>
              ) : null}
            </h1>
          </div>
          <Button
            href={albumHref({ view: 'calendar', y: year, order: undefined })}
          >
            カレンダー
          </Button>
        </div>

        <div data-motion="block">
          <SearchBox
            filter={filter}
            onPick={(next) =>
              url.set({
                ...filterParams(next),
                view: 'search',
                y: undefined,
                m: undefined,
                e: undefined,
                more: undefined,
                small: undefined,
              })
            }
            onRemove={(next) =>
              url.set({
                ...filterParams(next),
                // 検索の条件を、すべて外したら、検索結果の画面から、入口へ戻る
                ...(searching && countSearch(next) === 0
                  ? { view: undefined }
                  : {}),
                more: undefined,
              })
            }
          />
        </div>

        {entrance ? <Memories /> : null}

        {searching ? null : (
          <div data-motion="block">
            <TimeRuler
              overview={overview.data}
              order={order}
              zoom={zoom}
              year={rulerYear}
              months={yearData.data.months}
              month={month}
              eventHref={eventHref}
              onToggleOrder={toggleOrder}
            />
          </div>
        )}

        <FilterBar
          filter={filter}
          volumeLabels={volumeLabels}
          drawerOpen={drawer}
          onToggleDrawer={() => url.set({ drawer: drawer ? undefined : '1' })}
          onChange={changeFilter}
        />

        <div
          className={drawer ? 'grid items-start gap-6' : undefined}
          style={
            drawer ? { gridTemplateColumns: 'minmax(0,1fr) 340px' } : undefined
          }
        >
          <div className="flex min-w-0 flex-col gap-8">
            <div
              className="flex flex-wrap items-center gap-3"
              data-motion="block"
            >
              <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                {searching && searchResult.data
                  ? `${formatCount(searchResult.data.total)} 枚 / 代表の ${formatCount(searchResult.data.photos.length)} 枚を広げている`
                  : null}
                {zoom === 'all' &&
                  allSections.data &&
                  `${formatCount(allSections.data.total)} 枚 / 年月ごとに、すべて並べている`}
                {!searching &&
                  zoom === 'year' &&
                  `${formatCount(yearData.data.total)} 枚 / 月ごとの代表を広げている`}
                {zoom === 'month' &&
                  monthEvents &&
                  `${formatCount(monthEvents.total)} 枚 / できごと ${formatCount(monthEvents.events.length + monthEvents.small.length)} 件(束)`}
                {zoom === 'event' &&
                  event.data &&
                  `${formatCount(event.data.fileCount)} 枚 / ${formatCount(event.data.photos.length)} 枚を広げている`}
              </span>
            </div>

            {zoom === 'all' ? (
              <>
                <div className="flex flex-wrap gap-2" data-motion="block">
                  <FilterChip
                    selected={layout === 'masonry'}
                    onClick={() => url.set({ layout: undefined })}
                  >
                    マソンリー
                  </FilterChip>
                  <FilterChip
                    selected={layout === 'rows'}
                    onClick={() => url.set({ layout: 'rows' })}
                  >
                    行ぞろえ
                  </FilterChip>
                  <Button href={albumHref({ view: 'slide', order })}>
                    ▶ スライドショー
                  </Button>
                </div>
                {allSections.data ? (
                  <AllView
                    sections={allSections.data.sections}
                    order={order}
                    filter={filter}
                    layout={layout}
                  />
                ) : null}
              </>
            ) : null}
            {searching && searchResult.data ? (
              <>
                <SearchDesk
                  data={searchResult.data}
                  onMore={() =>
                    url.set({
                      more: String(
                        (toInt(url.get('more')) ?? SEARCH_STEP) + SEARCH_STEP
                      ),
                    })
                  }
                />
                {searchResult.data.total > 0 ? (
                  <div className="flex flex-wrap justify-end gap-4">
                    <Button href={albumHref({ view: 'slide', order })}>
                      ▶ スライドショー
                    </Button>
                    <Button
                      variant="y"
                      href={albumHref({ view: 'all', layout: 'rows', order })}
                    >
                      {formatCount(searchResult.data.total)}{' '}
                      件を一覧で(行ぞろえ) →
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {!searching && zoom === 'year' ? (
              <YearDesk data={yearData.data} />
            ) : null}
            {zoom === 'month' && monthEvents ? (
              <MonthDesk
                data={monthEvents}
                showSmall={showSmall}
                onToggleSmall={() =>
                  url.set({ small: showSmall ? undefined : '1' })
                }
              />
            ) : null}
            {zoom === 'event' && event.data ? (
              <>
                <EventDesk
                  data={event.data}
                  title={eventTitle(event.data.startAt)}
                  onMore={() => url.set({ more: String(more + EVENT_STEP) })}
                />
                <div className="flex justify-end">
                  <Button
                    href={albumHref({ view: 'slide', e: eventId, order })}
                  >
                    ▶ このできごとをスライドショー
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {event.data.previous ? (
                    <Button
                      href={albumHref({
                        view: 'event',
                        e: event.data.previous.albumEventId,
                        order,
                      })}
                    >
                      ← 前のできごと({eventTitle(event.data.previous.startAt)})
                    </Button>
                  ) : (
                    <Button disabled>← 前のできごと</Button>
                  )}
                  {event.data.next ? (
                    <Button
                      variant="y"
                      href={albumHref({
                        view: 'event',
                        e: event.data.next.albumEventId,
                        order,
                      })}
                    >
                      次のできごと({eventTitle(event.data.next.startAt)}) →
                    </Button>
                  ) : (
                    <Button disabled>次のできごと →</Button>
                  )}
                </div>
              </>
            ) : null}
          </div>
          {drawer ? (
            <FilterDrawer filter={filter} onChange={changeFilter} />
          ) : null}
        </div>
      </RevealPage>
    </AlbumFilterProvider>
  );
}

/** アルバム: 机・すべて・検索結果は、`AlbumBrowser`。写真の拡大表示(`view=photo`)は、別の画面(全面の暗い画面) */
export function AlbumView() {
  const url = useUrlState();
  const view = url.get('view');
  if (view === 'photo') return <PhotoViewer />;
  if (view === 'slide') return <Slideshow />;
  if (view === 'calendar') return <CalendarView />;
  return <AlbumBrowser />;
}
