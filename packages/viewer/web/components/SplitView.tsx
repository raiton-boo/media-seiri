'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { formatCount } from '../lib/format';
import { useUrlState } from '../lib/query-state';
import { Button } from './Button';
import { RevealCards } from './motion/Reveal';
import { Pager } from './Pager';

type Props<T> = {
  items: readonly T[];
  idOf: (item: T) => number;
  /** URL の `sel`(選んだ ID。前のページから戻ったときは `last`) */
  selectedParam: string | undefined | null;
  total: number;
  limit: number;
  offset: number;
  /** 左・右の幅の比(例: `4fr 8fr`) */
  columns: string;
  /** 「前の○○」「次の○○」の、○○(重複・エラー・実行) */
  noun: string;
  /** 一覧の上の見出し(列の名前など) */
  header?: ReactNode;
  /** 一覧の 1 件(押すと選ぶ。`select` を呼ぶ) */
  renderItem: (item: T, selected: boolean, select: () => void) => ReactNode;
  /** 選んだものの詳細 */
  detail: (selected: T) => ReactNode;
};

/**
 * 一覧(左)と詳細(右)の画面。比較・詳細の部分は、画面に固定され(開いたとき、そこまで動く)、左の一覧だけが、スクロールする。
 * 詳細の上に、大きな「前の○○」「次の○○」と、何件目か。← → キー(j k キー)でも動ける。ページの端では、前後のページへ続く。
 * 選んだものは、一覧の見える範囲に入る。
 */
export function SplitView<T>({
  items,
  idOf,
  selectedParam,
  total,
  limit,
  offset,
  columns,
  noun,
  header,
  renderItem,
  detail,
}: Props<T>) {
  const url = useUrlState();
  const listRef = useRef<HTMLDivElement>(null);
  const selectedId = Number(selectedParam) || undefined;
  const selected =
    items.find((item) => idOf(item) === selectedId) ??
    (selectedParam === 'last' ? items.at(-1) : undefined) ??
    items[0];
  const index = selected === undefined ? -1 : items.indexOf(selected);
  // 全体の中の、何件目か(ページをまたいで、続けて数える)
  const position = offset + index + 1;

  // 前へ・次へ(ボタンとキーで、同じ動き)。キーの受け口は、最新の動きを呼ぶ
  const goRef = useRef<(delta: number) => void>(() => {});
  goRef.current = (delta: number) => {
    const target = items[index + delta];
    if (target) {
      url.set({ sel: String(idOf(target)) });
    } else if (delta > 0 && offset + limit < total) {
      url.set({ offset: String(offset + limit), sel: undefined });
    } else if (delta < 0 && offset > 0) {
      const previous = Math.max(0, offset - limit);
      url.set({
        offset: previous === 0 ? undefined : String(previous),
        sel: 'last',
      });
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if (event.key === 'ArrowLeft' || event.key === 'k') goRef.current(-1);
      else if (event.key === 'ArrowRight' || event.key === 'j')
        goRef.current(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 最初に開いたとき、そこまで動く(以後は、画面に固定される)
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    document.querySelector('.split-view')?.scrollIntoView({ block: 'start' });
  }, []);
  // 選んだものが、左の一覧の見える範囲に入るように、一覧だけを、動かす
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選択・ページが変わったときだけ、動かす
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedParam, offset, items]);

  return (
    <div
      className="split-view"
      style={{ ['--split-cols' as string]: toColumns(columns) }}
    >
      <div className="split-list">
        <div className="split-items" ref={listRef}>
          <RevealCards className="flex flex-col gap-3">
            {header}
            {items.map((item) => {
              const id = idOf(item);
              const active = selected !== undefined && id === idOf(selected);
              return (
                <div
                  key={id}
                  data-motion="card"
                  data-active={active ? '' : undefined}
                >
                  {renderItem(item, active, () => url.set({ sel: String(id) }))}
                </div>
              );
            })}
          </RevealCards>
        </div>
        <div className="split-pager">
          <Pager
            stacked
            total={total}
            limit={limit}
            offset={offset}
            onChange={(next) =>
              url.set({
                offset: next === 0 ? undefined : String(next),
                sel: undefined,
              })
            }
          />
        </div>
      </div>
      <div className="split-detail">
        <div className="split-nav">
          <Button
            className="split-nav-btn"
            disabled={position <= 1}
            onClick={() => goRef.current(-1)}
          >
            ← 前の{noun}
          </Button>
          <span className="mono split-nav-pos">
            {formatCount(position)} / {formatCount(total)} 件目
            <br />
            <span style={{ fontSize: 12 }}>← → キーでも、動けます</span>
          </span>
          <Button
            variant="y"
            className="split-nav-btn"
            disabled={position >= total}
            onClick={() => goRef.current(1)}
          >
            次の{noun} →
          </Button>
        </div>
        {selected === undefined ? null : detail(selected)}
      </div>
    </div>
  );
}

/** `4fr 8fr` → `minmax(0,4fr) minmax(0,8fr)`(中身が広くても、欄が、はみ出さない) */
const toColumns = (columns: string): string =>
  columns
    .split(' ')
    .map((part) => `minmax(0, ${part})`)
    .join(' ');
