'use client';

import {
  countFilter,
  EMPTY_FILTER,
  type FilterState,
  isFiltered,
  type ListField,
} from '../../lib/album-filter';
import { Button } from '../Button';
import { FilterChip } from '../FilterChip';

export const KIND_LABELS: Record<string, string> = {
  photo: '写真',
  video: '動画',
  raw: 'RAW',
};
export const PRECISION_LABELS: Record<string, string> = {
  full: '日時まで',
  date: '日まで',
  month: '月まで',
  year: '年だけ',
  none: '日付なし',
  invalid: '無効な日付',
};
export const SOURCE_LABELS: Record<string, string> = {
  exif: 'EXIF',
  video: '動画のメタデータ',
  json: 'JSON(Google など)',
  filename: 'ファイル名',
  none: '取れなかった',
};

type Props = {
  filter: FilterState;
  /** ドライブの名前(ID から) */
  volumeLabels: Map<string, string>;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onChange: (next: FilterState) => void;
};

/** 有効な条件の札(押すと、その項目の条件を外す)。ドライブの名前は、引き出しを開くまで分からないので、番号で出す */
const describe = (
  filter: FilterState,
  volumeLabels: Map<string, string>
): { key: string; label: string; clear: Partial<FilterState> }[] => {
  const list = (
    key: ListField,
    title: string,
    name: (value: string) => string
  ) =>
    filter[key].length > 0
      ? [
          {
            key,
            label: `${title}: ${filter[key].map(name).join('・')}`,
            clear: { [key]: [] },
          },
        ]
      : [];
  return [
    ...list('kinds', '種別', (v) => KIND_LABELS[v] ?? v),
    ...list('cameras', 'カメラ', (v) => v),
    ...(filter.gps
      ? [
          {
            key: 'gps',
            label: `GPS: ${filter.gps === '1' ? 'あり' : 'なし'}`,
            clear: { gps: undefined },
          },
        ]
      : []),
    ...list('years', '年', (v) => `${v}年`),
    ...list('precisions', '日付の精度', (v) => PRECISION_LABELS[v] ?? v),
    ...list('sources', '取得元', (v) => SOURCE_LABELS[v] ?? v),
    ...list('volumes', 'ソース', (v) => volumeLabels.get(v) ?? `#${v}`),
  ];
};

/** 絞り込みの帯: 引き出しの開閉と、有効な条件の札(外せる)、全部クリア */
export function FilterBar({
  filter,
  volumeLabels,
  drawerOpen,
  onToggleDrawer,
  onChange,
}: Props) {
  const chips = describe(filter, volumeLabels);
  const count = countFilter(filter);
  return (
    <div className="flex flex-wrap items-center gap-3" data-motion="block">
      <Button selected={drawerOpen} onClick={onToggleDrawer}>
        絞り込み{count > 0 ? ` ${count}` : ''}
      </Button>
      {chips.map((chip) => (
        <FilterChip
          key={chip.key}
          selected
          onClick={() => onChange({ ...filter, ...chip.clear })}
        >
          {chip.label} ×
        </FilterChip>
      ))}
      {isFiltered(filter) ? (
        <Button onClick={() => onChange(EMPTY_FILTER)}>
          条件をすべてクリア
        </Button>
      ) : null}
    </div>
  );
}
