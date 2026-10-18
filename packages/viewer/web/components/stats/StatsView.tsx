'use client';

import Link from 'next/link';
import { AlbumFilterProvider } from '../../lib/album-context';
import {
  EMPTY_FILTER,
  type FilterState,
  toggleValue,
} from '../../lib/album-filter';
import { useStats } from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import {
  barHeight,
  barPercent,
  periodLabel,
  stackHeights,
} from '../../lib/stats';
import { useAlbumFilterState } from '../../lib/use-album-filter';
import { FilterChip } from '../FilterChip';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';

/** 期間別の棒グラフの、高さ(px) */
const CHART_HEIGHT = 200;
/** 種別の内訳の色(積み上げ) */
const KIND_COLORS = {
  photo: 'var(--y)',
  video: 'var(--b)',
  raw: 'var(--p)',
} as const;
const KIND_LABELS = { photo: '写真', video: '動画', raw: 'RAW' } as const;
const KINDS = ['photo', 'video', 'raw'] as const;
const PRECISIONS = [
  'full',
  'date',
  'month',
  'year',
  'none',
  'invalid',
] as const;
/** 日付フォールバック(本体のメタデータではなく、ほかから決めたもの)の取得元 */
const FALLBACK_SOURCES = ['json', 'filename', 'none'] as const;

type Bucket = { count: number; photo: number; video: number; raw: number };

/** 積み上げの棒 1 本(種別の内訳つき)。押せるなら、リンク */
function Bar({
  label,
  bucket,
  max,
  href,
  color,
  title,
}: {
  label: string;
  bucket: Bucket;
  max: number;
  href?: string;
  /** 単色の棒(内訳なし。「不明」) */
  color?: string;
  title: string;
}) {
  const parts = [bucket.photo, bucket.video, bucket.raw];
  const heights = stackHeights(parts, max, CHART_HEIGHT);
  const whole = barHeight(bucket.count, max, CHART_HEIGHT);
  const body = (
    <div
      className="flex h-full flex-col items-center justify-end gap-1"
      title={title}
    >
      <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
        {bucket.count > 0 ? formatCount(bucket.count) : ''}
      </span>
      <div
        style={{
          width: '100%',
          height: whole,
          border: bucket.count > 0 ? 'var(--bd)' : undefined,
          display: 'flex',
          flexDirection: 'column-reverse',
          background: color,
        }}
      >
        {color
          ? null
          : KINDS.map((kind, index) =>
              heights[index] ? (
                <div
                  key={kind}
                  style={{
                    height: heights[index],
                    background: KIND_COLORS[kind],
                    borderTop: index > 0 ? '2px solid var(--ink)' : undefined,
                  }}
                />
              ) : null
            )}
      </div>
    </div>
  );
  return (
    <div className="flex flex-1 flex-col items-stretch" style={{ minWidth: 0 }}>
      <div style={{ height: CHART_HEIGHT + 24 }}>
        {href && bucket.count > 0 ? (
          <Link
            href={href}
            className="block h-full"
            aria-label={`${label} ${bucket.count} 枚`}
          >
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
      <div
        className="mono"
        style={{ textAlign: 'center', fontSize: 12, paddingTop: 4 }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * 統計: 数字で見る。期間別(月別・年別。種別の内訳つき。日付が不明なものは「不明」の棒)・カメラ別・撮影時間帯・全体の概要。
 * 種別で絞り込める(すべてのグラフに効く)。グラフの項目を押すと、その条件のアルバムへ。
 */
export function StatsView() {
  const state = useAlbumFilterState();
  const { url, filter, albumHref } = state;
  const unit = url.get('unit') === 'year' ? 'year' : 'month';
  const yearParam = Number(url.get('y')) || undefined;
  const { data, isError } = useStats(yearParam, filter);

  if (isError) {
    return (
      <div className="page">
        <LoadError>統計を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!data) return <ListSkeleton />;

  const { periods } = data;
  const kindOn = (kind: string) => filter.kinds.includes(kind);
  const setKinds = (kinds: string[]): void =>
    url.set({ kind: kinds.length > 0 ? kinds : undefined });

  const items =
    unit === 'month'
      ? periods.months.map((m) => ({
          key: `m${m.month}`,
          label: `${m.month}月`,
          bucket: m as Bucket,
          href:
            periods.monthsYear === null
              ? undefined
              : albumHref({ view: 'month', y: periods.monthsYear, m: m.month }),
        }))
      : periods.years.map((y) => ({
          key: `y${y.year}`,
          label: String(y.year),
          bucket: y as Bucket,
          href: albumHref({ view: 'year', y: y.year }),
        }));
  const unknown = unit === 'month' ? periods.monthUnknown : periods.yearUnknown;
  // 不明: 月別は、その年の「年だけ」のもの。年別は、日付のないもの(押すと、その精度の「すべて」へ)
  const unknownHref = albumHref({
    view: 'all',
    filter: {
      ...filter,
      precisions: unit === 'month' ? ['year'] : ['none', 'invalid'],
      ...(unit === 'month' && periods.monthsYear !== null
        ? { years: [String(periods.monthsYear)] }
        : {}),
    },
  });
  const max = Math.max(
    1,
    unknown.count,
    ...items.map((item) => item.bucket.count)
  );

  const cameraMax = Math.max(1, ...data.cameras.map((camera) => camera.count));
  const hourMax = Math.max(1, ...data.hours);
  const kindsTotal = data.kinds.photo + data.kinds.video + data.kinds.raw;
  const precisionTotal = Object.values(data.precisions).reduce(
    (a, b) => a + b,
    0
  );

  const withFilter = (next: Partial<FilterState>): FilterState => ({
    ...EMPTY_FILTER,
    ...filter,
    ...next,
  });

  return (
    <AlbumFilterProvider filter={filter} drawer={false}>
      <RevealPage className="page">
        <div
          className="flex flex-wrap items-end justify-between gap-6"
          data-motion="title"
        >
          <div>
            <div className="kicker">STATISTICS</div>
            <h1 className="h1">統計</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              selected={filter.kinds.length === 0}
              onClick={() => setKinds([])}
            >
              全種別
            </FilterChip>
            {KINDS.map((kind) => (
              <FilterChip
                key={kind}
                selected={kindOn(kind)}
                onClick={() => setKinds(toggleValue(filter.kinds, kind))}
              >
                {KIND_LABELS[kind]}
              </FilterChip>
            ))}
          </div>
        </div>

        {data.total === 0 ? (
          <div className="card">
            <div className="h2">
              {filter.kinds.length > 0
                ? '条件に合う写真は、0 件'
                : 'まだ、写真が、ありません'}
            </div>
          </div>
        ) : (
          <>
            <div
              className="grid gap-6"
              style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
              data-motion="block"
            >
              <div className="card s">
                <div className="kicker">TOTAL</div>
                <div className="num m">{formatCount(data.total)}</div>
                <div className="mono" style={{ fontSize: 13 }}>
                  ファイル
                </div>
              </div>
              <div className="card s">
                <div className="kicker">SIZE</div>
                <div className="num m">{formatBytes(data.sizeBytes)}</div>
                <div className="mono" style={{ fontSize: 13 }}>
                  総サイズ
                </div>
              </div>
              <div className="card s">
                <div className="kicker">PERIOD</div>
                <div className="h2" style={{ paddingTop: 4 }}>
                  {data.period
                    ? `${periodLabel(data.period.from)} 〜 ${periodLabel(data.period.to)}`
                    : '—'}
                </div>
                <div className="mono" style={{ fontSize: 13 }}>
                  最初と最後の撮影日
                </div>
              </div>
              <div className="card s">
                <div className="kicker">GPS</div>
                <div className="num m">{formatCount(data.gps.with)}</div>
                <div className="mono" style={{ fontSize: 13 }}>
                  あり ／ なし {formatCount(data.gps.without)}{' '}
                  <Link
                    href="/map"
                    className="textlink"
                    style={{ fontSize: 14 }}
                  >
                    地図へ →
                  </Link>
                </div>
              </div>
            </div>

            <div className="card" data-motion="block">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="h2">期間別の件数</div>
                <div className="flex flex-wrap items-center gap-3">
                  {unit === 'month' ? (
                    <div className="seg y">
                      {[...periods.years].reverse().map((item) => (
                        <button
                          key={item.year}
                          type="button"
                          className={
                            item.year === periods.monthsYear ? 'on' : undefined
                          }
                          aria-pressed={item.year === periods.monthsYear}
                          onClick={() => url.set({ y: String(item.year) })}
                        >
                          {item.year}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="seg">
                    <button
                      type="button"
                      className={unit === 'month' ? 'on' : undefined}
                      aria-pressed={unit === 'month'}
                      onClick={() => url.set({ unit: undefined })}
                    >
                      月別
                    </button>
                    <button
                      type="button"
                      className={unit === 'year' ? 'on' : undefined}
                      aria-pressed={unit === 'year'}
                      onClick={() => url.set({ unit: 'year' })}
                    >
                      年別
                    </button>
                  </div>
                </div>
              </div>
              <div
                className="flex items-end gap-3"
                style={{ borderBottom: 'var(--bd)', padding: '0 4px' }}
              >
                {items.map((item) => (
                  <Bar
                    key={item.key}
                    label={item.label}
                    bucket={item.bucket}
                    max={max}
                    href={item.href}
                    title={`${item.label}: 写真 ${item.bucket.photo} / 動画 ${item.bucket.video} / RAW ${item.bucket.raw}`}
                  />
                ))}
                <Bar
                  label="不明"
                  bucket={unknown as Bucket}
                  max={max}
                  href={unknownHref}
                  color="var(--l)"
                  title="年月が取れていないもの"
                />
              </div>
              <div
                className="mono mt-3 flex flex-wrap items-center gap-4"
                style={{ fontSize: 12 }}
              >
                {KINDS.map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-2">
                    <i
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        border: '2px solid var(--ink)',
                        background: KIND_COLORS[kind],
                      }}
                    />
                    {KIND_LABELS[kind]}
                  </span>
                ))}
                <span className="muted">
                  {unit === 'month' && periods.monthsYear !== null
                    ? `${periods.monthsYear}年 / `
                    : ''}
                  年月が取れていないものは「不明」にまとめ、合計が全体の件数と合う。棒を押すと、その期間のアルバムへ。
                </span>
              </div>
            </div>

            <div
              className="grid gap-8"
              style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
            >
              <div className="card b flex flex-col gap-3" data-motion="block">
                <div className="h2">カメラ別</div>
                {data.cameras.map((camera) => (
                  <Link
                    key={camera.name}
                    href={albumHref({
                      view: 'all',
                      filter: withFilter({ cameras: [camera.name] }),
                    })}
                    className="grid items-center gap-3"
                    style={{ gridTemplateColumns: '150px minmax(0,1fr) 70px' }}
                  >
                    <span
                      className="mono truncate"
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {camera.name}
                    </span>
                    <span
                      style={{
                        height: 18,
                        border: 'var(--bd)',
                        background: 'var(--paper)',
                        display: 'block',
                      }}
                    >
                      <i
                        style={{
                          display: 'block',
                          height: '100%',
                          width: `${barPercent(camera.count, cameraMax)}%`,
                          background: 'var(--ink)',
                        }}
                      />
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 13, textAlign: 'right' }}
                    >
                      {formatCount(camera.count)}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="card p flex flex-col gap-3" data-motion="block">
                <div className="h2">撮影時間帯</div>
                <div
                  className="flex items-end gap-1"
                  style={{ height: 170, borderBottom: 'var(--bd)' }}
                >
                  {data.hours.map((count, hour) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 0〜23 時の固定の並び
                    <div
                      key={`h${hour}`}
                      title={`${hour} 時: ${count} 枚`}
                      style={{
                        flex: 1,
                        height: barHeight(count, hourMax, 166, 3),
                        border: count > 0 ? '2px solid var(--ink)' : undefined,
                        background: 'var(--paper)',
                      }}
                    />
                  ))}
                </div>
                <div
                  className="mono flex justify-between"
                  style={{ fontSize: 12 }}
                >
                  <span>0</span>
                  <span>6</span>
                  <span>12</span>
                  <span>18</span>
                  <span>23 時</span>
                </div>
                <div className="mono" style={{ fontSize: 12 }}>
                  時刻が取れていないもの(精度が full 未満)の{' '}
                  {formatCount(data.hoursExcluded)} 件は、対象外。
                </div>
              </div>
            </div>

            <div
              className="grid gap-8"
              style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
            >
              <div className="card g flex flex-col gap-3" data-motion="block">
                <div className="h2">日付の精度</div>
                <div className="mono" style={{ fontSize: 14, lineHeight: 2 }}>
                  {PRECISIONS.map((precision) => (
                    <div key={precision}>
                      <Link
                        href={albumHref({
                          view: 'all',
                          filter: withFilter({ precisions: [precision] }),
                        })}
                        className="textlink"
                        style={{ fontSize: 14 }}
                      >
                        {precision}
                      </Link>{' '}
                      <b>{formatCount(data.precisions[precision] ?? 0)}</b>
                    </div>
                  ))}
                  <div style={{ fontSize: 12 }}>
                    合計 {formatCount(precisionTotal)}
                  </div>
                </div>
              </div>
              <div className="card o flex flex-col gap-3" data-motion="block">
                <div className="h2">日付フォールバック</div>
                <div className="mono" style={{ fontSize: 14, lineHeight: 2 }}>
                  {FALLBACK_SOURCES.map((source) => (
                    <div key={source}>
                      {source} <b>{formatCount(data.sources[source] ?? 0)}</b>
                    </div>
                  ))}
                </div>
                <Link
                  href="/fallback"
                  className="textlink"
                  style={{ alignSelf: 'flex-start', fontSize: 16 }}
                >
                  一覧へ →
                </Link>
              </div>
              <div className="card l flex flex-col gap-3" data-motion="block">
                <div className="h2">種別</div>
                <div className="mono" style={{ fontSize: 14, lineHeight: 2 }}>
                  {KINDS.map((kind) => (
                    <div key={kind}>
                      {KIND_LABELS[kind]} <b>{formatCount(data.kinds[kind])}</b>
                    </div>
                  ))}
                  <div style={{ fontSize: 12 }}>
                    合計 {formatCount(kindsTotal)}
                    (種別の絞り込みは、ここには効かない)
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </RevealPage>
    </AlbumFilterProvider>
  );
}
