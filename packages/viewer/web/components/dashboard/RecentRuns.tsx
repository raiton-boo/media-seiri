import type { RunSummary } from '@file-seiri/ledger';
import { formatCount, formatDateTime } from '../../lib/format';
import { Button } from '../Button';
import { RUN_KIND_LABELS, RunStatusChip } from '../RunLabels';

/** 最近の実行の表。検査・サムネイルの作成も、実行として並ぶ(ソースの欄に、種類を出す) */
export function RecentRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="card">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="h2">最近の実行</div>
        <Button href="/runs" variant="y">
          すべて見る →
        </Button>
      </div>
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
            <th>日時</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td colSpan={8}>まだ実行の記録がありません</td>
            </tr>
          ) : (
            runs.map((run) => {
              const kindLabel =
                run.kind === 'ingest' ? null : RUN_KIND_LABELS[run.kind];
              return (
                <tr
                  key={run.runId}
                  className={run.status === 'running' ? 'hl' : undefined}
                >
                  <td className="m">#{run.runId}</td>
                  <td>
                    {kindLabel ? (
                      <span className="chip" style={{ marginRight: 8 }}>
                        {kindLabel}
                      </span>
                    ) : null}
                    {run.sourceLabel ?? '—'}
                  </td>
                  <td>
                    <RunStatusChip run={run} />
                  </td>
                  <td className="m">{formatCount(run.adopted)}</td>
                  <td className="m">{formatCount(run.duplicates)}</td>
                  <td className="m">{formatCount(run.dateFallback)}</td>
                  <td className="m">{formatCount(run.errors)}</td>
                  <td className="m">
                    {formatDateTime(run.startedAt)}
                    {run.status === 'running' ? ' →' : ''}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
