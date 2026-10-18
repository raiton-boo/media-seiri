'use client';

import { useRuns } from '../../lib/api';
import { formatCount, formatShortDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { FilterChip } from '../FilterChip';
import { ListSkeleton } from '../ListSkeleton';
import { Pager } from '../Pager';
import { RUN_KIND_LABELS, RunStatusChip } from '../RunLabels';
import { RunDetailCard } from './RunDetailCard';

const FILTERS = [
  { value: undefined, label: 'すべて' },
  { value: 'normal', label: '通常' },
  { value: 'dry-run', label: 'DRY-RUN' },
  { value: 'interrupted', label: '中断' },
] as const;

/** 実行履歴: 実行ごとの記録(dry-run・検査・サムネイルの作成を含む)。行を選ぶと、右に詳細 */
export function RunsView() {
  const url = useUrlState();
  const filter = url.get('filter');
  const offset = Number(url.get('offset')) || 0;
  const { data, isPending, isError } = useRuns({ filter, offset });

  if (isError) {
    return (
      <div className="page">
        <div className="note">実行履歴を読み込めませんでした。</div>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const selectedId = Number(url.get('sel')) || undefined;
  const selected =
    data.items.find((run) => run.runId === selectedId) ?? data.items[0];

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="kicker">RUN HISTORY</div>
          <h1 className="h1">実行履歴</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <FilterChip
              key={item.label}
              selected={filter === item.value}
              onClick={() =>
                url.set({
                  filter: item.value,
                  offset: undefined,
                  sel: undefined,
                })
              }
            >
              {item.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {data.total === 0 ? (
        <div className="card">
          <div className="h2">該当する実行は、ありません</div>
        </div>
      ) : (
        <div
          className="grid items-start gap-6"
          style={{ gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)' }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4">
              <div className="listhead runhead" aria-hidden="true">
                <span>実行</span>
                <span>ソース / 採用・重複・フォールバック・エラー</span>
                <span>状態 / 開始</span>
              </div>
              {data.items.map((run) => (
                <Button
                  key={run.runId}
                  block
                  selected={run.runId === selected?.runId}
                  className="runcard"
                  onClick={() => url.set({ sel: String(run.runId) })}
                >
                  <span className="runcard-id">#{run.runId}</span>
                  <span className="runcard-main">
                    <span className="runcard-source">
                      {run.kind === 'ingest' ? null : (
                        <span className="chip">
                          {RUN_KIND_LABELS[run.kind]}
                        </span>
                      )}
                      {run.sourceLabel ?? '—'}
                    </span>
                    <span className="mono runcard-counts">
                      採用 {formatCount(run.adopted)} / 重複{' '}
                      {formatCount(run.duplicates)} / フォールバック{' '}
                      {formatCount(run.dateFallback)} / エラー{' '}
                      {formatCount(run.errors)}
                    </span>
                  </span>
                  <span className="runcard-side">
                    <RunStatusChip run={run} />
                    <span className="mono">
                      {formatShortDateTime(run.startedAt)}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
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
          {selected ? <RunDetailCard id={selected.runId} /> : null}
        </div>
      )}
    </div>
  );
}
