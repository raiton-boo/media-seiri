'use client';

import { useRunDetail } from '../../lib/api';
import {
  describePlace,
  formatBytes,
  formatCount,
  formatDateTime,
  formatDuration,
} from '../../lib/format';
import { Button } from '../Button';
import { RUN_KIND_LABELS } from '../RunLabels';

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="card s">
      <div className="mono" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div className="num m">{formatCount(value)}</div>
    </div>
  );
}

/** 実行 1 件の詳細。dry-run は黄色(「実行の結果は、集計に含まれない」ことを、色でも示す) */
export function RunDetailCard({ id }: { id: number }) {
  const { data, isPending, isError } = useRunDetail(id);
  if (isError)
    return <div className="card note">詳細を読み込めませんでした。</div>;
  if (isPending)
    return (
      <div
        className="sk"
        style={{ height: 420 }}
        role="status"
        aria-label="読み込み中"
      />
    );
  const { run, library } = data;
  const place = describePlace(library.mediaKind, library.fsType);
  const isIngest = run.kind === 'ingest';
  const seconds = run.finishedAt
    ? (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
      1000
    : null;
  return (
    <div className={`card flex flex-col gap-4 ${run.isDryRun ? 'y' : ''}`}>
      <div className="flex items-center justify-between">
        <h2 className="h2">run #{run.runId}</h2>
        <span className="flex gap-2">
          {run.kind === 'ingest' ? null : (
            <span className="chip">{RUN_KIND_LABELS[run.kind]}</span>
          )}
          {run.isDryRun ? <span className="chip on">DRY-RUN</span> : null}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 12, lineHeight: 1.9 }}>
        ソース {run.sourceLabel ?? '—'}
        <br />
        開始 {formatDateTime(run.startedAt)}
        {seconds === null ? ' / 実行中' : ` / 所要 ${formatDuration(seconds)}`}
        <br />
        保存先 {library.name}
        {place ? `(${place})` : ''}
      </div>
      {isIngest ? (
        <>
          <hr className="hr" />
          <div className="grid grid-cols-2 gap-3">
            <Count label="検出" value={run.detected} />
            <Count
              label={run.isDryRun ? 'コピー予定' : '採用'}
              value={run.copyFiles}
            />
            <Count
              label={run.isDryRun ? '重複スキップ予定' : '重複スキップ'}
              value={run.duplicates}
            />
            <Count label="対象外" value={run.ignored} />
          </div>
          <div className="card s">
            <div className="mono" style={{ fontSize: 12, lineHeight: 1.8 }}>
              {run.capacity ? (
                <>
                  必要な容量 {formatBytes(run.capacity.requiredBytes)}
                  (余裕分を含む)
                  <br />
                  保存先の空き {formatBytes(run.capacity.destinationFreeBytes)}{' '}
                  →{' '}
                  {run.capacity.destinationFreeBytes >=
                  run.capacity.requiredBytes
                    ? '足りています'
                    : `足りません(不足 ${formatBytes(run.capacity.requiredBytes - run.capacity.destinationFreeBytes)})`}
                </>
              ) : (
                <>
                  {run.isDryRun ? 'コピーする予定のサイズ' : 'コピーしたサイズ'}{' '}
                  {formatBytes(run.copyBytes)}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button href={`/dupes?run=${run.runId}`}>重複一覧</Button>
            <Button href={`/fallback?run=${run.runId}`}>フォールバック</Button>
            <Button href={`/errors?run=${run.runId}`}>エラー</Button>
          </div>
        </>
      ) : (
        <>
          <hr className="hr" />
          <div className="flex flex-wrap gap-2">
            <Button href={`/errors?run=${run.runId}`}>
              エラー {formatCount(run.errors)}
            </Button>
          </div>
        </>
      )}
      {run.isDryRun ? (
        <div className="note" style={{ background: 'var(--paper)' }}>
          dry-run の結果は、アルバム・地図・統計には含まれません。
        </div>
      ) : null}
    </div>
  );
}
