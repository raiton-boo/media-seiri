import type { DashboardSummary } from '@file-seiri/ledger';
import { formatCount } from '../../lib/format';
import { Button } from '../Button';

type Item = {
  href: string;
  label: string;
  count: number;
  /** 色の意味(design.md §2): 赤=エラー、オレンジ=注意、紫=日付なし、青=情報 */
  tone: 'r' | 'o' | 'l' | 'b';
};

/** 「要チェック」: 注意が必要な項目への、リンクと件数。押せるため、ボタンと同じ動き(ホバーで浮き、押すと沈む) */
export function Attention({
  attention,
}: {
  attention: DashboardSummary['attention'];
}) {
  const items: Item[] = [
    { href: '/errors', label: 'エラー', count: attention.errors, tone: 'r' },
    {
      href: '/fallback',
      label: '日付フォールバック',
      count: attention.dateFallback,
      tone: 'o',
    },
    {
      href: '/fallback',
      label: '日付なし (_unknown)',
      count: attention.dateUnknown,
      tone: 'l',
    },
    {
      href: '/dupes',
      label: '重複スキップ',
      count: attention.duplicates,
      tone: 'b',
    },
  ];
  return (
    <div className="card flex flex-col gap-4">
      <h2 className="h2">要チェック</h2>
      {items.map((item) => (
        <Button key={item.label} href={item.href} tone={item.tone} block>
          <span>{item.label} →</span>
          <span className="num m">{formatCount(item.count)}</span>
        </Button>
      ))}
    </div>
  );
}
