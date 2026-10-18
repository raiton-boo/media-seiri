'use client';

import { Suspense } from 'react';
import { useDashboard } from '../../lib/api';
import {
  describePlace,
  formatCount,
  formatDateTime,
  formatPeriodEnd,
  splitBytes,
} from '../../lib/format';
import { Attention } from './Attention';
import { DashboardSkeleton } from './DashboardSkeleton';
import { RecentRuns } from './RecentRuns';
import { RunningCard } from './RunningCard';

function Dashboard() {
  const { data } = useDashboard();
  const { summary, library, runs, running, disk } = data;
  const { files, period, gps } = summary;
  const size = splitBytes(summary.files.sizeBytes);
  const place = describePlace(library.mediaKind, library.fsType);
  const idPrefix = `${library.id.slice(0, 4)}…`;

  return (
    <div className="page">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="kicker">LIBRARY / DASHBOARD</div>
          <h1 className="h1">
            写真は、ぜんぶ
            <br />
            ここに揃っている。
          </h1>
          <div className="mono" style={{ fontSize: 12, paddingTop: 10 }}>
            ライブラリ {library.name}(ID {idPrefix})
            {place ? ` / 場所 ${place}` : ''}
            {summary.lastIngestAt
              ? ` / 最終の取り込み ${formatDateTime(summary.lastIngestAt)}`
              : ' / まだ取り込んでいません'}
          </div>
        </div>
        <div className="chip y">閲覧専用 / READ-ONLY</div>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <div className="card y">
          <div className="kicker">FILES</div>
          <div className="num">{formatCount(files.total)}</div>
          <div className="mono" style={{ fontSize: 12 }}>
            写真 {formatCount(files.photos)} / 動画 {formatCount(files.videos)}{' '}
            / RAW {formatCount(files.raws)}
          </div>
        </div>
        <div className="card">
          <div className="kicker">SIZE</div>
          <div className="num">
            {size.value}
            <span style={{ fontSize: 24 }}> {size.unit}</span>
          </div>
          <div className="mono" style={{ fontSize: 12 }}>
            {disk
              ? `空き ${splitBytes(disk.freeBytes).value} ${splitBytes(disk.freeBytes).unit} / ${splitBytes(disk.totalBytes).value} ${splitBytes(disk.totalBytes).unit}`
              : 'ドライブの容量: 未接続'}
          </div>
        </div>
        <div className="card b">
          <div className="kicker">PERIOD</div>
          <div className="num m" style={{ paddingTop: 12 }}>
            {period
              ? `${formatPeriodEnd(period.from)} → ${formatPeriodEnd(period.to)}`
              : '—'}
          </div>
          <div className="mono" style={{ fontSize: 12 }}>
            日付が取れた範囲
          </div>
        </div>
        <div className="card g">
          <div className="kicker">GPS</div>
          <div className="num">{formatCount(gps.with)}</div>
          <div className="mono" style={{ fontSize: 12 }}>
            付き {formatCount(gps.with)} / なし {formatCount(gps.without)}{' '}
            <a href="/map" style={{ textDecoration: 'underline' }}>
              地図へ →
            </a>
          </div>
        </div>
      </div>

      <div
        className="grid gap-8"
        style={{ gridTemplateColumns: 'minmax(0,7fr) minmax(0,5fr)' }}
      >
        <RunningCard running={running} lastRun={runs[0] ?? null} />
        <Attention attention={summary.attention} />
      </div>

      <RecentRuns runs={runs} />
    </div>
  );
}

export function DashboardView() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}
