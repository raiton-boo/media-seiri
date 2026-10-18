'use client';

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

  if (isError) {
    return (
      <div className="page">
        <LoadError>重複比較を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const selectedId = Number(url.get('sel')) || undefined;
  const selected =
    data.items.find((group) => group.adoptedLibraryFileId === selectedId) ??
    data.items[0];
  // 絞り込みを変えたら、ページと選択は、最初に戻す
  const filterTo = (updates: Record<string, string | undefined>) =>
    url.set({ offset: undefined, sel: undefined, ...updates });

  return (
    <RevealPage className="page">
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
        <div
          className="grid items-start gap-6"
          style={{ gridTemplateColumns: 'minmax(0,4fr) minmax(0,8fr)' }}
        >
          <div className="flex flex-col gap-4">
            <RevealCards
              key={`${volume}|${run}|${q}|${offset}`}
              className="flex flex-col gap-4"
            >
              {data.items.map((group) => (
                <div key={group.adoptedLibraryFileId} data-motion="card">
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
            <Pager
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
          {selected ? <DupeDetail id={selected.adoptedLibraryFileId} /> : null}
        </div>
      )}
      <div className="note">
        この画面は確認専用です。ファイルの変更・コピー・削除の操作は、ありません。
      </div>
    </RevealPage>
  );
}
