import type { RunningProgress, RunSummary } from '@file-seiri/ledger';
import {
  estimatePace,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
} from '../../lib/format';
import { CountUp } from '../motion/CountUp';
import { GrowBar } from '../motion/GrowBar';
import { PulseDot } from '../motion/PulseDot';
import { LiveLog } from './LiveLog';

/**
 * 実行中の取り込みの進み具合(ピンクのカード)。実行中だけ表示する(この Mac の作業用の台帳のとき)。
 * 実行中でなければ、同じ形の、静かなカードで、直近の実行を知らせる。
 */
export function RunningCard({
  running,
  lastRun,
}: {
  running: RunningProgress | null;
  lastRun: RunSummary | null;
}) {
  if (!running) {
    return (
      <div className="card flex flex-col gap-4">
        <div className="kicker">NO RUN IN PROGRESS</div>
        <div className="h2">いま、実行中の取り込みは、ありません</div>
        <div className="mono" style={{ fontSize: 13 }}>
          {lastRun
            ? `直近の実行: #${lastRun.runId}(${formatDateTime(lastRun.startedAt)})`
            : 'まだ実行の記録がありません'}
        </div>
        <div className="mono muted" style={{ fontSize: 13 }}>
          ※ 実行中だけ表示(この Mac)。他の PC では、最後の snapshot の内容。
        </div>
      </div>
    );
  }
  const pace = estimatePace(running, new Date());
  return (
    <div className="card p flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="kicker">NOW RUNNING / run #{running.runId}</div>
          <div className="h2">{running.sourceLabel ?? '取り込み'}</div>
        </div>
        <div className="chip ink on">
          <PulseDot />
          LIVE
        </div>
      </div>
      <div
        className="bar"
        role="progressbar"
        aria-valuenow={pace.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <GrowBar percent={pace.percent} />
      </div>
      <div
        className="flex justify-between"
        style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700 }}
      >
        <span>
          {formatCount(running.done)} / {formatCount(running.total)} ファイル
        </span>
        <span>{pace.percent}%</span>
        <span>
          {pace.bytesPerSecond === null
            ? '—'
            : `${formatBytes(pace.bytesPerSecond)}/s`}
        </span>
        <span>
          {pace.remainingSeconds === null
            ? '残り —'
            : `残り ~${formatDuration(pace.remainingSeconds)}`}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-3 text-center">
        <Counter label="採用" value={running.adopted} />
        <Counter label="重複" value={running.duplicates} />
        <Counter label="FALLBACK" value={running.dateFallback} />
        <Counter label="ERROR" value={running.errors} />
      </div>
      <LiveLog />
      <div className="mono muted" style={{ fontSize: 13 }}>
        ※ 実行中だけ表示(この Mac)。他の PC では、最後の snapshot の内容。
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="card s">
      <div className="mono" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div className="num m">
        <CountUp value={value} />
      </div>
    </div>
  );
}
