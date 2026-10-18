'use client';

import { useEffect, useRef, useState } from 'react';

/** 入力が止まってから、検索に反映するまでの時間(ミリ秒) */
const DEBOUNCE_MS = 300;

/**
 * 検索の入力欄。入力が止まってから、`onSearch` を呼ぶ(1 文字ごとに、読み直さないため)。
 * `value` は、URL にある、いまの検索語(戻る・進むで変わったときに、入力欄にも反映する)。
 */
export function SearchField({
  id,
  value,
  placeholder,
  onSearch,
}: {
  id: string;
  value: string;
  placeholder: string;
  onSearch: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setText(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      id={id}
      type="search"
      className="sel"
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch(next), DEBOUNCE_MS);
      }}
      style={{ width: '100%' }}
    />
  );
}
