import type { DashboardSummary } from '@file-seiri/ledger';
import Link from 'next/link';
import { formatCount } from '../../lib/format';

type Item = {
  href: string;
  label: string;
  count: number;
  /** 色の意味(design.md §2): 赤=エラー、オレンジ=注意、紫=日付なし、青=情報 */
  background: string;
  color?: string;
};

/** 「要チェック」: 注意が必要な項目への、リンクと件数 */
export function Attention({
  attention,
}: {
  attention: DashboardSummary['attention'];
}) {
  const items: Item[] = [
    {
      href: '/errors',
      label: 'エラー',
      count: attention.errors,
      background: 'var(--r)',
      color: 'var(--paper)',
    },
    {
      href: '/fallback',
      label: '日付フォールバック',
      count: attention.dateFallback,
      background: 'var(--o)',
    },
    {
      href: '/fallback',
      label: '日付なし (_unknown)',
      count: attention.dateUnknown,
      background: 'var(--l)',
    },
    {
      href: '/dupes',
      label: '重複スキップ',
      count: attention.duplicates,
      background: 'var(--b)',
    },
  ];
  return (
    <div className="card flex flex-col gap-3">
      <div className="h2">要チェック</div>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className="card s flex items-center justify-between"
          style={{ background: item.background, color: item.color }}
        >
          <span style={{ fontWeight: 900 }}>{item.label}</span>
          <span className="num m">{formatCount(item.count)}</span>
        </Link>
      ))}
    </div>
  );
}
