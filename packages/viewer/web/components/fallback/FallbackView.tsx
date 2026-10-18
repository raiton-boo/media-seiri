'use client';

import { useFallback } from '../../lib/api';
import {
  describeLocation,
  formatCount,
  formatDateTime,
} from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { FilterChip } from '../FilterChip';
import { ListSkeleton } from '../ListSkeleton';
import { CountUp } from '../motion/CountUp';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';
import { Pager } from '../Pager';

const SOURCES = [
  { value: undefined, label: 'すべて' },
  { value: 'json', label: 'json' },
  { value: 'filename', label: 'filename' },
  { value: 'none', label: 'none' },
] as const;

const PRECISIONS = [
  undefined,
  'full',
  'date',
  'month',
  'year',
  'none',
  'invalid',
] as const;

/** 取得元の札の色(意味: 黄=ファイル名、青=json、赤=どこからも取れない) */
const SOURCE_CHIP: Record<string, string> = {
  filename: 'chip y',
  json: 'chip b',
  none: 'chip r',
};

/**
 * 日付フォールバック一覧: 本体のメタデータに、撮影日時がなかったもの。
 * 取得元(json・filename・none)・日付の精度・ソースのドライブ・実行で絞り込める。
 */
export function FallbackView() {
  const url = useUrlState();
  const source = url.get('source');
  const precision = url.get('precision');
  const volume = url.get('volume');
  const run = url.get('run');
  const offset = Number(url.get('offset')) || 0;
  const { data, isPending, isError } = useFallback({
    source,
    precision,
    volume,
    run,
    offset,
  });

  if (isError) {
    return (
      <div className="page">
        <LoadError>日付フォールバック一覧を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const { counts } = data;
  const all = counts.json + counts.filename + counts.none;
  // 絞り込みを変えたら、ページは、最初に戻す
  const filterTo = (updates: Record<string, string | undefined>) =>
    url.set({ offset: undefined, ...updates });

  return (
    <RevealPage className="page">
      <div
        className="flex flex-wrap items-end justify-between gap-6"
        data-motion="title"
      >
        <div>
          <div className="kicker">DATE FALLBACK</div>
          <h1 className="h1">日付フォールバック</h1>
        </div>
        <div className="chip o">
          本体のメタデータに、撮影日時がなかったもの {formatCount(all)} 件
        </div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <div className="card y" data-motion="block">
          <div className="kicker">filename</div>
          <div className="num m" style={{ paddingTop: 6 }}>
            <CountUp value={counts.filename} />
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            ファイル名から読めた
          </div>
        </div>
        <div className="card b" data-motion="block">
          <div className="kicker">json</div>
          <div className="num m" style={{ paddingTop: 6 }}>
            <CountUp value={counts.json} />
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            Takeout の json
          </div>
        </div>
        <div className="card r" data-motion="block">
          <div className="kicker">none</div>
          <div className="num m" style={{ paddingTop: 6 }}>
            <CountUp value={counts.none} />
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            どこからも取れない → _unknown
          </div>
        </div>
        <div className="card l" data-motion="block">
          <div className="kicker">mtime(参考)</div>
          <div className="num m" style={{ paddingTop: 6 }}>
            採用しない
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            更新日は、参考情報のみ
          </div>
        </div>
      </div>

      <div
        className="card s flex flex-wrap items-end gap-4"
        data-motion="block"
      >
        <div className="field">
          <span className="flabel">日付の取得元</span>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((item) => (
              <FilterChip
                key={item.label}
                selected={source === item.value}
                onClick={() => filterTo({ source: item.value })}
              >
                {item.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="flabel">日付の精度</span>
          <div className="flex flex-wrap gap-2">
            {PRECISIONS.map((item) => (
              <FilterChip
                key={item ?? 'all'}
                selected={precision === item}
                onClick={() => filterTo({ precision: item })}
              >
                {item ?? 'すべて'}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="fallback-volume">ソース</label>
          <select
            id="fallback-volume"
            className="sel"
            value={volume ?? ''}
            onChange={(event) => filterTo({ volume: event.target.value })}
          >
            <option value="">すべて</option>
            {data.volumes.map((item) => (
              <option key={item.volumeId} value={item.volumeId}>
                {item.label ?? `ドライブ ${item.volumeId}`}
              </option>
            ))}
          </select>
        </div>
        {run ? (
          <div className="field">
            <span className="flabel">実行</span>
            <FilterChip selected onClick={() => filterTo({ run: undefined })}>
              #{run}(押すと、解除)
            </FilterChip>
          </div>
        ) : null}
      </div>

      {data.total === 0 ? (
        <div className="card g">
          <div className="h2">該当するファイルは、ありません</div>
        </div>
      ) : (
        <>
          <table className="tbl">
            <thead>
              <tr>
                <th>ファイル</th>
                <th>決定した日付</th>
                <th>精度</th>
                <th>取得元</th>
                <th>理由</th>
                <th>参考の更新日</th>
                <th>保存先</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.libraryFileId}>
                  <td
                    className="m"
                    title={describeLocation(item.source, false)}
                  >
                    {describeLocation(item.source, true)}
                  </td>
                  <td className="m nw">{item.takenAt ?? '—'}</td>
                  <td>
                    <span className="chip">{item.datePrecision}</span>
                  </td>
                  <td>
                    <span className={SOURCE_CHIP[item.dateSource] ?? 'chip'}>
                      {item.dateSource}
                    </span>
                  </td>
                  <td>{item.dateReason}</td>
                  <td className="m nw">
                    {item.mtimeRefMs === null
                      ? '—'
                      : formatDateTime(new Date(item.mtimeRefMs).toISOString())}
                  </td>
                  <td className="m" title={item.libraryRelPath}>
                    {item.libraryRelPath}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            total={data.total}
            limit={data.limit}
            offset={data.offset}
            onChange={(next) =>
              url.set({ offset: next === 0 ? undefined : String(next) })
            }
          />
        </>
      )}
      <div className="note">
        none のものは、_unknown/日付なし/
        に、元のファイル名のまま保存されています。
      </div>
    </RevealPage>
  );
}
