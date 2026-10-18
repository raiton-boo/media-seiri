'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useViewerInfo } from '../lib/api';
import { formatDateTime } from '../lib/format';

/** 上のナビ。すべての画面が、ここでつながっている(design.md §5) */
export const NAV_ITEMS = [
  { href: '/', label: 'ダッシュボード' },
  // カレンダーは、アルバムの見方の 1 つ(別のページだが、ナビは「アルバム」のまま)
  { href: '/album', label: 'アルバム', also: ['/calendar'] },
  { href: '/map', label: '地図' },
  { href: '/stats', label: '統計' },
  { href: '/dupes', label: '重複比較' },
  { href: '/fallback', label: '日付フォールバック' },
  { href: '/errors', label: 'エラー' },
  { href: '/runs', label: '実行履歴' },
] as const;

const isActive = (
  pathname: string,
  href: string,
  also: readonly string[] = []
): boolean =>
  href === '/'
    ? pathname === '/'
    : [href, ...also].some((path) => pathname.startsWith(path));

/** 右上のチップ: ライブラリの名前と、台帳の鮮度(この Mac は最新、家の PC などは、スナップショットの時刻) */
function LibraryChip() {
  const { data } = useViewerInfo();
  if (!data) {
    return (
      <div className="libchip">
        <span className="dot" />
        <span className="muted">読み込み中…</span>
      </div>
    );
  }
  return (
    <div className="libchip">
      <span className="dot" />
      {data.library.name}
      <span className="muted">
        {data.source === 'snapshot'
          ? `/ snapshot ${formatDateTime(data.asOf)}`
          : '/ 最新(この Mac の台帳)'}
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app">
      <div className="top">
        <div className="logo">file-seiri</div>
        <nav className="nav" aria-label="画面">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive(pathname, item.href, 'also' in item ? item.also : [])
                  ? 'on'
                  : undefined
              }
              aria-current={
                isActive(pathname, item.href, 'also' in item ? item.also : [])
                  ? 'page'
                  : undefined
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <LibraryChip />
      </div>
      {children}
    </div>
  );
}
