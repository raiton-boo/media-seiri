'use client';

import type { ReactNode } from 'react';
import {
  countFilter,
  type FilterState,
  type ListField,
  toggleValue,
} from '../../lib/album-filter';
import { useAlbumFilters } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { KIND_LABELS, PRECISION_LABELS, SOURCE_LABELS } from './FilterBar';

type RowProps = {
  on: boolean;
  label: ReactNode;
  count: number;
  onClick: () => void;
};

/** 引き出しの 1 行: チェックの箱・名前・件数。件数 0 で、選んでもいないものは、淡く(押しても、結果は空) */
function Row({ on, label, count, onClick }: RowProps) {
  const empty = count === 0 && !on;
  return (
    <button
      type="button"
      className={`rw${empty ? ' off' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span>
        <i className={`bx2${on ? ' on' : ''}`} />
        {label}
      </span>
      <span className="mono">{formatCount(count)}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gp">
      <div className="kicker">{title}</div>
      {children}
    </div>
  );
}

/** 絞り込みの引き出し(右): 項目ごとのチェックと件数。件数は、ほかの条件のもとで、数え直す */
export function FilterDrawer({
  filter,
  onChange,
}: {
  filter: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const { data, isError } = useAlbumFilters(filter, true);
  const list = (field: ListField, value: string) => ({
    on: filter[field].includes(value),
    onClick: () =>
      onChange({ ...filter, [field]: toggleValue(filter[field], value) }),
  });
  const count = countFilter(filter);
  return (
    <aside className="fdr" aria-label="絞り込み" data-motion="block">
      <div
        className="gp"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span className="h2" style={{ fontSize: 20 }}>
          絞り込み
        </span>
        {count > 0 ? <span className="chip y">{count} 件の条件</span> : null}
      </div>
      {isError ? (
        <div className="gp note">選択肢を読み込めませんでした。</div>
      ) : !data ? (
        <div
          className="sk"
          style={{ height: 320 }}
          role="status"
          aria-label="読み込み中"
        />
      ) : (
        <>
          <Group title="種別">
            {data.kinds.map((item) => (
              <Row
                key={item.value}
                {...list('kinds', item.value)}
                label={KIND_LABELS[item.value] ?? item.value}
                count={item.count}
              />
            ))}
          </Group>
          <Group title="カメラ">
            {data.cameras.map((item) => (
              <Row
                key={item.value}
                {...list('cameras', item.value)}
                label={item.value}
                count={item.count}
              />
            ))}
          </Group>
          <Group title="GPS">
            <Row
              on={filter.gps === '1'}
              label="あり"
              count={data.gps.with}
              onClick={() =>
                onChange({
                  ...filter,
                  gps: filter.gps === '1' ? undefined : '1',
                })
              }
            />
            <Row
              on={filter.gps === '0'}
              label="なし"
              count={data.gps.without}
              onClick={() =>
                onChange({
                  ...filter,
                  gps: filter.gps === '0' ? undefined : '0',
                })
              }
            />
          </Group>
          <Group title="年">
            {data.years.map((item) => (
              <Row
                key={item.value}
                {...list('years', String(item.value))}
                label={`${item.value}年`}
                count={item.count}
              />
            ))}
          </Group>
          <Group title="日付の精度">
            {data.precisions.map((item) => (
              <Row
                key={item.value}
                {...list('precisions', item.value)}
                label={PRECISION_LABELS[item.value] ?? item.value}
                count={item.count}
              />
            ))}
          </Group>
          <Group title="日付の取得元">
            {data.dateSources.map((item) => (
              <Row
                key={item.value}
                {...list('sources', item.value)}
                label={SOURCE_LABELS[item.value] ?? item.value}
                count={item.count}
              />
            ))}
          </Group>
          {data.volumes.length > 0 ? (
            <Group title="ソース">
              {data.volumes.map((item) => (
                <Row
                  key={item.volumeId}
                  {...list('volumes', String(item.volumeId))}
                  label={item.label ?? `ドライブ #${item.volumeId}`}
                  count={item.count}
                />
              ))}
            </Group>
          ) : null}
        </>
      )}
    </aside>
  );
}
