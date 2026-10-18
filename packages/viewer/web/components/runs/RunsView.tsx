'use client';

import { useRuns } from '../../lib/api';
import { formatCount, formatDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
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
            <button
              key={item.label}
              type="button"
              className={filter === item.value ? 'chip on' : 'chip'}
              onClick={() =>
                url.set({
                  filter: item.value,
                  offset: undefined,
                  sel: undefined,
                })
              }
            >
              {item.label}
            </button>
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
            <table className="tbl">
              <thead>
                <tr>
                  <th>実行</th>
                  <th>ソース</th>
                  <th>状態</th>
                  <th>採用</th>
                  <th>重複</th>
                  <th>フォールバック</th>
                  <th>エラー</th>
                  <th>開始</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr
                    key={run.runId}
                    className={run.runId === selected?.runId ? 'hl' : undefined}
                  >
                    <td className="m">
                      <button
                        type="button"
                        className="rowbtn"
                        aria-pressed={run.runId === selected?.runId}
                        onClick={() => url.set({ sel: String(run.runId) })}
                      >
                        #{run.runId}
                      </button>
                    </td>
                    <td>
                      {run.kind === 'ingest' ? null : (
                        <span className="chip" style={{ marginRight: 8 }}>
                          {RUN_KIND_LABELS[run.kind]}
                        </span>
                      )}
                      {run.sourceLabel ?? '—'}
                    </td>
                    <td>
                      <RunStatusChip run={run} />
                    </td>
                    <td className="m">{formatCount(run.adopted)}</td>
                    <td className="m">{formatCount(run.duplicates)}</td>
                    <td className="m">{formatCount(run.dateFallback)}</td>
                    <td className="m">{formatCount(run.errors)}</td>
                    <td className="m">{formatDateTime(run.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
