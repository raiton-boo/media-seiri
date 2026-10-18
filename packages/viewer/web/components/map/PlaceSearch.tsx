'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { MapPlacesResponse } from '../../../src/api-types.ts';
import { useMapPlaces } from '../../lib/api';
import { formatCount } from '../../lib/format';

type Place = MapPlacesResponse['places'][number];

/** 入力が止まってから、探しに行くまでの間(ms) */
const DEBOUNCE_MS = 200;

/**
 * 場所の指定: 地名(市区町村・都道府県・国。日本語・英語)を入れて、決めると、地図が、その場所へ動く。
 * 写真のない場所にも、動ける(枚数に「写真なし」と出す)。↑↓ で選び、Enter で決める。
 */
export function PlaceSearch({ onPick }: { onPick: (place: Place) => void }) {
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
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const { data } = useMapPlaces(debounced);
  const places = debounced.trim() === '' ? [] : (data?.places ?? []);

  const pick = (place: Place) => {
    onPick(place);
    setText('');
    setDebounced('');
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return; // 日本語の変換中の Enter は、変換の確定
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(places.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Escape') {
      setOpen(false);
      event.currentTarget.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = places[active];
      if (chosen) pick(chosen);
    }
  };

  return (
    <div className="relative" ref={root} style={{ minWidth: 320 }}>
      <div className="srch" style={{ minWidth: 0 }}>
        <span className="ic" aria-hidden="true">
          ⌖
        </span>
        <input
          className="srch-input"
          value={text}
          placeholder="場所へ移動(地名・都道府県・国)"
          aria-label="場所の指定"
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
      </div>
      {open && text.trim() !== '' ? (
        <div
          id={listId}
          className="fdr"
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            top: 'calc(100% + 10px)',
            width: '100%',
            minWidth: 320,
            zIndex: 6,
          }}
        >
          <div className="gp" style={{ gap: 4, padding: '6px 16px' }}>
            {places.length === 0 ? (
              <div className="mono muted" style={{ fontSize: 13 }}>
                見つかりません
              </div>
            ) : (
              places.map((place, index) => (
                <button
                  key={place.ref}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`rw${index === active ? ' active' : ''}`}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => pick(place)}
                >
                  <span>{place.label}</span>
                  <span className="mono">
                    {place.count > 0
                      ? `${formatCount(place.count)} 枚`
                      : '写真なし'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
