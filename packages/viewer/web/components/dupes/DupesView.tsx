'use client';

import { useEffect, useRef } from 'react';
import { useDupes } from '../../lib/api';
import { baseName, formatCount, shortHash } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealCards, RevealPage } from '../motion/Reveal';
import { Pager } from '../Pager';
import { RUN_KIND_LABELS } from '../RunLabels';
import { SearchField } from '../SearchField';
import { DupeDetail } from './DupeDetail';

/**
 * 重複比較(確認のみ): 同じ内容のファイルを、グループ(採用 1 + スキップ N)にまとめて一覧し、
 * 選ぶと、右に、採用側とスキップ側を並べて比べる。ファイルの変更・コピー・削除の操作は、ない。
 */
export function DupesView() {
  const url = useUrlState();
  const volume = url.get('volume');
  const run = url.get('run');
  const q = url.get('q');
  const offset = Number(url.get('offset')) || 0;
  const { data, isPending, isError } = useDupes({ volume, run, q, offset });
  const listRef = useRef<HTMLDivElement>(null);
  // 前へ・次へ(ボタンとキーで、同じ動き)。キーの受け口は、最新の動きを呼ぶ
  const goRef = useRef<(delta: number) => void>(() => {});
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
  // 最初に開いたとき、比較の部分が、画面いっぱいになるよう、そこまで動かす(以後は、画面に固定される)
  const arrived = useRef(false);
  const ready = Boolean(data && data.total > 0);
  useEffect(() => {
    if (!ready || arrived.current) return;
    arrived.current = true;
    document.querySelector('.dupes-split')?.scrollIntoView({ block: 'start' });
  }, [ready]);
  // 選んだものが、左の一覧の見える範囲に入るように、一覧だけを、動かす
  const selectedKey = url.get('sel');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 選択・ページが変わったときだけ、動かす
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, offset, data]);

  if (isError) {
    return (
      <div className="page">
        <LoadError>重複比較を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const selectedParam = url.get('sel');
  const selectedId = Number(selectedParam) || undefined;
  // 前のページから、「前へ」で戻ってきたときは、そのページの最後(`sel=last`)
  const selected =
    data.items.find((group) => group.adoptedLibraryFileId === selectedId) ??
    (selectedParam === 'last' ? data.items.at(-1) : undefined) ??
    data.items[0];
  const index = selected ? data.items.indexOf(selected) : -1;
  // 全体の中の、何件目か(ページをまたいで、続けて数える)
  const position = data.offset + index + 1;
  goRef.current = (delta: number) => {
    const target = data.items[index + delta];
    if (target) {
      url.set({ sel: String(target.adoptedLibraryFileId) });
    } else if (delta > 0 && data.offset + data.limit < data.total) {
      url.set({ offset: String(data.offset + data.limit), sel: undefined });
    } else if (delta < 0 && data.offset > 0) {
      const previous = Math.max(0, data.offset - data.limit);
      url.set({
        offset: previous === 0 ? undefined : String(previous),
        sel: 'last',
      });
    }
  };
  // 絞り込みを変えたら、ページと選択は、最初に戻す
  const filterTo = (updates: Record<string, string | undefined>) =>
    url.set({ offset: undefined, sel: undefined, ...updates });

  return (
    <RevealPage className="page dupes-page">
      <div
        className="flex flex-wrap items-end justify-between gap-6"
        data-motion="title"
      >
        <div>
          <div className="kicker">DUPLICATES / 確認のみ</div>
          <h1 className="h1">重複比較</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="chip y">
            重複 {formatCount(data.totalSkipped)} 件
          </span>
          <span className="chip">ハッシュ完全一致のみ</span>
        </div>
      </div>

      <div
        className="card s flex flex-wrap items-end gap-4"
        data-motion="block"
      >
        <div className="field">
          <label htmlFor="dupes-volume">ソース</label>
          <select
            id="dupes-volume"
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
        <div className="field">
          <label htmlFor="dupes-run">実行</label>
          <select
            id="dupes-run"
            className="sel"
            value={run ?? ''}
            onChange={(event) => filterTo({ run: event.target.value })}
          >
            <option value="">すべて(通常の実行)</option>
            {data.runs.map((item) => (
              <option key={item.runId} value={item.runId}>
                #{item.runId}
                {item.kind === 'ingest' ? '' : ` ${RUN_KIND_LABELS[item.kind]}`}
                {item.isDryRun ? ' DRY-RUN' : ''}
                {item.sourceLabel ? ` / ${item.sourceLabel}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <label htmlFor="dupes-q">検索</label>
          <SearchField
            id="dupes-q"
            value={q ?? ''}
            placeholder="ファイル名で検索…"
            onSearch={(text) => filterTo({ q: text })}
          />
        </div>
      </div>

      {data.total === 0 ? (
        <div className="card g">
          <div className="h2">重複は、ありません</div>
        </div>
      ) : (
        <div className="dupes-split">
          <div className="dupes-list">
            <div className="dupes-items" ref={listRef}>
              <RevealCards className="flex flex-col gap-4">
                {data.items.map((group) => (
                  <div
                    key={group.adoptedLibraryFileId}
                    data-motion="card"
                    data-active={
                      group.adoptedLibraryFileId ===
                      selected?.adoptedLibraryFileId
                        ? ''
                        : undefined
                    }
                  >
                    <Button
                      block
                      selected={
                        group.adoptedLibraryFileId ===
                        selected?.adoptedLibraryFileId
                      }
                      className="dupecard"
                      onClick={() =>
                        url.set({ sel: String(group.adoptedLibraryFileId) })
                      }
                    >
                      <span className="mono dupecard-count">
                        採用 1 / スキップ {formatCount(group.skippedCount)}
                      </span>
                      <span
                        className="mono dupecard-name"
                        title={group.adoptedRelPath}
                      >
                        {baseName(group.adoptedRelPath)}
                      </span>
                      <span className="mono dupecard-hash">
                        sha256: {shortHash(group.contentHash)}
                      </span>
                    </Button>
                  </div>
                ))}
              </RevealCards>
            </div>
            <div className="dupes-pager">
              <Pager
                stacked
                total={data.total}
                limit={data.limit}
                offset={data.offset}
                onChange={(next) =>
                  url.set({
                    offset: next === 0 ? undefined : String(next),
                    sel: undefined,
                  })
                }
              />
            </div>
          </div>
          <div className="dupes-detail">
            <div className="dupes-nav">
              <Button
                className="dupes-nav-btn"
                disabled={position <= 1}
                onClick={() => goRef.current(-1)}
              >
                ← 前の重複
              </Button>
              <span className="mono dupes-nav-pos">
                {formatCount(position)} / {formatCount(data.total)} 件目
                <br />
                <span style={{ fontSize: 12 }}>← → キーでも、動けます</span>
              </span>
              <Button
                variant="y"
                className="dupes-nav-btn"
                disabled={position >= data.total}
                onClick={() => goRef.current(1)}
              >
                次の重複 →
              </Button>
            </div>
            {selected ? (
              <DupeDetail id={selected.adoptedLibraryFileId} />
            ) : null}
          </div>
        </div>
      )}
      <div className="note">
        この画面は確認専用です。ファイルの変更・コピー・削除の操作は、ありません。
      </div>
    </RevealPage>
  );
}
