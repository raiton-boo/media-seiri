'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useViewerInfo } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button } from './Button';
import { NumFit } from './NumFit';

/** 上のナビ。すべての画面が、ここでつながっている(design.md §5) */
export const NAV_ITEMS = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/album', label: 'アルバム' },
  // アルバムの見方の 1 つ。別のページなので、ナビでも、アルバムの右に並べる
  { href: '/calendar', label: 'カレンダー' },
  // できごと・動画・RAW・場所などで、自動でまとめたアルバム
  { href: '/albums', label: '自動アルバム' },
  { href: '/map', label: '地図' },
  { href: '/stats', label: '統計' },
  { href: '/dupes', label: '重複比較' },
  { href: '/fallback', label: '日付フォールバック' },
  { href: '/errors', label: 'エラー' },
  { href: '/runs', label: '実行履歴' },
] as const;

const isActive = (pathname: string, href: string): boolean =>
  href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);

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

/**
 * 状態の帯(上のナビの下): ドライブが外れているときは、注意(オレンジ。「再確認」つき)。スナップショットを見ているときは、そのことを伝える(青)。
 * サムネイルの一覧は、ドライブが外れていても、見られる。
 */
function NoticeBands() {
  const { data, refetch, isFetching } = useViewerInfo();
  if (!data) return null;
  const disconnected = !data.libraryConnected;
  const snapshot = data.source === 'snapshot';
  if (!disconnected && !snapshot) return null;
  return (
    <div className="bands">
      {disconnected ? (
        <div className="card o band" role="status">
          <b>
            「{data.library.name}」のドライブを接続してください(原本を開くため)
          </b>
          <Button loading={isFetching} onClick={() => void refetch()}>
            再確認
          </Button>
        </div>
      ) : null}
      {snapshot ? (
        <div className="card l band">
          <span>
            <b>最後の snapshot の内容です({formatDateTime(data.asOf)})。</b>{' '}
            {staleDays(data.asOf) >= STALE_DAYS ? (
              <b>最終の更新は {staleDays(data.asOf)} 日前です。 </b>
            ) : null}
            新しい取り込みは、この Mac で行います。
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** これより古い snapshot には、「何日前か」を、添える(日数) */
const STALE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const staleDays = (asOf: string): number =>
  Math.floor((Date.now() - new Date(asOf).getTime()) / MS_PER_DAY);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="app">
      <NumFit />
      <div className="top">
        <div className="logo">file-seiri</div>
        <nav className="nav" aria-label="画面">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={isActive(pathname, item.href) ? 'on' : undefined}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <LibraryChip />
      </div>
      <NoticeBands />
      {children}
    </div>
  );
}
