import type { RunSummary } from '@file-seiri/ledger';

/** 取り込み以外の実行の種類の名前 */
export const RUN_KIND_LABELS = {
  verify: '検査',
  thumbs: 'サムネイル',
} as const;

/** 実行の状態の札(色の意味: 緑=完了、ピンク=実行中、オレンジ=中断、赤=失敗) */
export function RunStatusChip({
  run,
}: {
  run: Pick<RunSummary, 'isDryRun' | 'status'>;
}) {
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
