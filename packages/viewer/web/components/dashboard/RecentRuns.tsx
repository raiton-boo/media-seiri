import type { RunSummary } from '@file-seiri/ledger';
import Link from 'next/link';
import { formatCount, formatDateTime } from '../../lib/format';

const KIND_LABELS = { verify: '検査', thumbs: 'サムネイル' } as const;

/** 状態の札(色の意味: 緑=完了、ピンク=実行中、赤=失敗) */
function StatusChip({ run }: { run: RunSummary }) {
  if (run.isDryRun) return <span className="chip">DRY-RUN</span>;
  switch (run.status) {
    case 'running':
      return <span className="chip p">実行中</span>;
    case 'completed':
      return <span className="chip g">完了</span>;
    case 'interrupted':
      return <span className="chip o">中断</span>;
    case 'failed':
      return <span className="chip r">失敗</span>;
  }
}

/** 最近の実行の表。検査・サムネイルの作成も、実行として並ぶ(ソースの欄に、種類を出す) */
export function RecentRuns({ runs }: { runs: RunSummary[] }) {
  return (
    <div className="card">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="h2">最近の実行</div>
        <Link href="/runs" className="btn y">
          すべて見る →
        </Link>
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
                run.kind === 'ingest' ? null : KIND_LABELS[run.kind];
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
                    <StatusChip run={run} />
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
