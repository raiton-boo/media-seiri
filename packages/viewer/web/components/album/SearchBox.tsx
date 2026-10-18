'use client';

import type { SearchSuggestion } from '@file-seiri/ledger';
import { useEffect, useId, useRef, useState } from 'react';
import type { AreaSuggestion } from '../../../src/api-types.ts';
import type { FilterState } from '../../lib/album-filter';
import {
  describeDate,
  describePlace,
  placeValue,
} from '../../lib/album-search';
import { useAreaLabels, useSearchSuggest } from '../../lib/api';
import { formatCount } from '../../lib/format';

/** 入力が止まってから、候補を取りに行くまでの間(ms) */
const DEBOUNCE_MS = 200;

type Candidate = SearchSuggestion | AreaSuggestion;

const TYPE_LABELS: Record<Candidate['type'], string> = {
  area: '場所',
  date: '日付',
  name: '名前',
  camera: 'カメラ',
  place: '場所',
};
/** 候補の種類の色(文字は、黒) */
const TYPE_CLASS: Record<Candidate['type'], string> = {
  area: 'chip g',
  date: 'chip p',
  name: 'chip b',
  camera: 'chip o',
  place: 'chip g',
};

/** 候補を選んだあとの条件 */
const withSuggestion = (filter: FilterState, item: Candidate): FilterState => {
  const add = (list: string[], value: string) =>
    list.includes(value) ? list : [...list, value];
  switch (item.type) {
    case 'date':
      return { ...filter, dates: add(filter.dates, item.value) };
    case 'name':
      return { ...filter, names: add(filter.names, item.value) };
    case 'camera':
      return { ...filter, cameras: add(filter.cameras, item.value) };
    case 'area':
      return { ...filter, areas: add(filter.areas, item.value) };
    case 'place':
      return { ...filter, places: add(filter.places, placeValue(item.value)) };
  }
};

type Props = {
  filter: FilterState;
  /** 条件を決めた(候補を選んだ、Enter)。検索結果の画面へ移る */
  onPick: (next: FilterState) => void;
  /** 札の × で、条件を外した */
  onRemove: (next: FilterState) => void;
};

/**
 * 検索の札: 入力すると、日付・名前・カメラ・場所の候補が、件数つきで出る。決めた条件は、黄色の札になり、× で外せる。
 * ↑↓ で候補を選び、Enter で決める。Esc で閉じる。候補がなくて Enter なら、名前の一部として探す。
 */
export function SearchBox({ filter, onPick, onRemove }: Props) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  // 外を押したら、閉じる
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const { data } = useSearchSuggest(debounced, filter, open);
  const areaLabels = useAreaLabels(filter.areas).data?.labels ?? {};
  const suggestions = data?.suggestions ?? [];

  const pick = (item: Candidate) => {
    onPick(withSuggestion(filter, item));
    setText('');
    setDebounced('');
    setOpen(false);
  };

  const chips = [
    ...filter.dates.map((value) => ({
      key: `d${value}`,
      label: describeDate(value),
      remove: { ...filter, dates: filter.dates.filter((v) => v !== value) },
    })),
    ...filter.names.map((value) => ({
      key: `n${value}`,
      label: `名前: ${value}`,
      remove: { ...filter, names: filter.names.filter((v) => v !== value) },
    })),
    ...filter.areas.map((value) => ({
      key: `a${value}`,
      label: areaLabels[value] ?? '…',
      remove: { ...filter, areas: filter.areas.filter((v) => v !== value) },
    })),
    ...filter.places.map((value) => ({
      key: `p${value}`,
      label: describePlace(value),
      remove: { ...filter, places: filter.places.filter((v) => v !== value) },
    })),
  ];

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return; // 日本語の変換中の Enter は、変換の確定
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) =>
        Math.min(index + 1, Math.max(suggestions.length - 1, 0))
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Escape') {
      setOpen(false);
      event.currentTarget.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen && text.trim() === debounced.trim()) pick(chosen);
      else if (text.trim() !== '')
        pick({
          type: 'name',
          value: text.trim(),
          label: text.trim(),
          count: 0,
        });
    } else if (event.key === 'Backspace' && text === '' && chips.length > 0) {
      // 入力が空のとき、Backspace で、いちばん後ろの札を外す
      onRemove(chips[chips.length - 1]?.remove ?? filter);
    }
  };

  return (
    <div className="relative" ref={root}>
      <div className="srch" style={{ width: '100%', flexWrap: 'wrap' }}>
        <span className="ic" aria-hidden="true">
          ⌕
        </span>
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="chip y"
            aria-label={`${chip.label} を外す`}
            onClick={() => onRemove(chip.remove)}
          >
            {chip.label} ×
          </button>
        ))}
        <input
          className="srch-input"
          value={text}
          placeholder={
            chips.length === 0 ? '日付・カメラ・場所・ファイル名で探す' : ''
          }
          aria-label="検索"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <span
          className="mono muted"
          style={{ marginLeft: 'auto', fontSize: 12 }}
        >
          Enter で検索 ／ Esc で閉じる
        </span>
      </div>
      {open ? (
        <div
          id={listId}
          className="fdr"
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            top: 'calc(100% + 10px)',
            width: 'min(560px, 100%)',
            zIndex: 6,
          }}
        >
          <div className="gp" style={{ padding: '8px 16px' }}>
            <div className="kicker">候補</div>
          </div>
          <div className="gp" style={{ gap: 4, padding: '6px 16px' }}>
            {suggestions.length === 0 ? (
              <div className="mono muted" style={{ fontSize: 13 }}>
                {text.trim() === ''
                  ? '入力すると、候補が出ます'
                  : '候補は、ありません(Enter で、名前の一部として探します)'}
              </div>
            ) : (
              suggestions.map((item, index) => (
                <button
                  // 候補は、種類と値で決まる
                  key={`${item.type}-${JSON.stringify(item.value)}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`rw${index === active ? ' active' : ''}`}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => pick(item)}
                >
                  <span>
                    <span
                      className={TYPE_CLASS[item.type]}
                      style={{ marginRight: 8 }}
                    >
                      {TYPE_LABELS[item.type]}
                    </span>
                    {item.label}
                  </span>
                  <span className="mono">{formatCount(item.count)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
