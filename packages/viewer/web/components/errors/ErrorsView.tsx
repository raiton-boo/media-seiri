'use client';

import type { BrowsedError } from '@file-seiri/ledger';
import { errorsCsvUrl, useErrors } from '../../lib/api';
import { formatCount, formatDateTimeSeconds } from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { ListSkeleton } from '../ListSkeleton';
import { Pager } from '../Pager';
import { RUN_KIND_LABELS } from '../RunLabels';
import { ErrorDetail } from './ErrorDetail';

/** エラーになったファイルの表示(`ドライブ名/パス`、ZIP の中身なら ` ! 中のパス`) */
export const describeSource = (source: BrowsedError['source']): string => {
  if (!source) return '(ファイルなし)';
  const path = `${source.volumeLabel ?? ''}/${source.relPath}`;
  return source.entryPath ? `${path} ! ${source.entryPath}` : path;
};

/** エラー一覧: コード・実行で絞り込み、行を選ぶと、右に詳細(サムネイル・内容・修復の経過) */
export function ErrorsView() {
  const url = useUrlState();
  const code = url.get('code');
  const run = url.get('run');
  const offset = Number(url.get('offset')) || 0;
  const { data, isPending, isError } = useErrors({ code, run, offset });

  if (isError) {
    return (
      <div className="page">
        <div className="note">エラー一覧を読み込めませんでした。</div>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const totalCodes = data.codes.reduce((sum, item) => sum + item.count, 0);
  const selectedId = Number(url.get('sel')) || undefined;
  const selected =
    data.items.find((item) => item.errorId === selectedId) ?? data.items[0];
  // 絞り込みを変えたら、ページと選択は、最初に戻す
  const filterTo = (updates: Record<string, string | undefined>) =>
    url.set({ offset: undefined, sel: undefined, ...updates });

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="kicker">ERRORS</div>
          <h1 className="h1">エラー一覧</h1>
        </div>
        <Button href={errorsCsvUrl({ code, run })} download>
          CSV で書き出す
        </Button>
      </div>

      <div className="card s flex flex-wrap items-end gap-4">
        <div className="field">
          <span className="kicker" style={{ fontSize: 11 }}>
            コード
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={code === undefined ? 'chip on' : 'chip'}
              onClick={() => filterTo({ code: undefined })}
            >
              すべて {formatCount(totalCodes)}
            </button>
            {data.codes.map((item) => (
              <button
                key={item.code}
                type="button"
                className={code === item.code ? 'chip on' : 'chip r'}
                onClick={() => filterTo({ code: item.code })}
              >
                {item.code} {formatCount(item.count)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="error-run">実行</label>
          <select
            id="error-run"
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
      </div>

      {data.total === 0 ? (
        <div className="card g">
          <div className="h2">エラーは、ありません</div>
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
                  <th>コード</th>
                  <th>ファイル</th>
                  <th>実行</th>
                  <th>日時</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.errorId}
                    className={
                      item.errorId === selected?.errorId ? 'hl' : undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="rowbtn"
                        aria-pressed={item.errorId === selected?.errorId}
                        onClick={() => url.set({ sel: String(item.errorId) })}
                      >
                        <span className="chip r">{item.code}</span>
                      </button>
                    </td>
                    <td className="m" style={{ wordBreak: 'break-all' }}>
                      {describeSource(item.source)}
                    </td>
                    <td className="m">#{item.runId}</td>
                    <td className="m">
                      {formatDateTimeSeconds(item.occurredAt)}
                    </td>
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
          {selected ? <ErrorDetail id={selected.errorId} /> : null}
        </div>
      )}
    </div>
  );
}
