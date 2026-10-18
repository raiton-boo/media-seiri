'use client';

import type { BrowsedError } from '@file-seiri/ledger';
import { errorsCsvUrl, useErrors } from '../../lib/api';
import {
  describeLocation,
  formatCount,
  formatDateTimeSeconds,
} from '../../lib/format';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { FilterChip } from '../FilterChip';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';
import { RUN_KIND_LABELS } from '../RunLabels';
import { SplitView } from '../SplitView';
import { CsvButton } from './CsvButton';
import { ErrorDetail } from './ErrorDetail';

/** エラーになったファイルの表示(全体) */
export const describeSource = (source: BrowsedError['source']): string =>
  describeLocation(source, false);

/** 表では、長いパスを、ドライブ名と最後の 2 つのフォルダ・ファイル名に省く(全体は、ホバーと、右の詳細に出す) */
export const shortenSource = (source: BrowsedError['source']): string =>
  describeLocation(source, true);

/** エラー一覧: コード・実行で絞り込み、行を選ぶと、右に詳細(サムネイル・内容・修復の経過) */
export function ErrorsView() {
  const url = useUrlState();
  const code = url.get('code');
  const run = url.get('run');
  const offset = Number(url.get('offset')) || 0;
  const { data, isPending, isError } = useErrors({ code, run, offset });

  if (isError) {
    return (
      <div className="page">
        <LoadError>エラー一覧を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (isPending) return <ListSkeleton />;

  const totalCodes = data.codes.reduce((sum, item) => sum + item.count, 0);
  // 絞り込みを変えたら、ページと選択は、最初に戻す
  const filterTo = (updates: Record<string, string | undefined>) =>
    url.set({ offset: undefined, sel: undefined, ...updates });

  return (
    <RevealPage className="page split-page">
      <div
        className="flex flex-wrap items-end justify-between gap-6"
        data-motion="title"
      >
        <div>
          <div className="kicker">ERRORS</div>
          <h1 className="h1">エラー一覧</h1>
        </div>
        <CsvButton href={errorsCsvUrl({ code, run })} />
      </div>

      <div
        className="card s flex flex-wrap items-end gap-4"
        data-motion="block"
      >
        <div className="field">
          <span className="flabel">コード</span>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              selected={code === undefined}
              onClick={() => filterTo({ code: undefined })}
            >
              すべて {formatCount(totalCodes)}
            </FilterChip>
            {data.codes.map((item) => (
              <FilterChip
                key={item.code}
                selected={code === item.code}
                tone="r"
                onClick={() => filterTo({ code: item.code })}
              >
                {item.code} {formatCount(item.count)}
              </FilterChip>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="error-run">実行</label>
          <select
            id="error-run"
            className="sel"
            value={run ?? ''}
            onChange={(event) => filterTo({ run: event.target.value })}
          >
            <option value="">すべて(通常の実行)</option>
            {data.runs.map((item) => (
              <option key={item.runId} value={item.runId}>
                #{item.runId}
                {item.kind === 'ingest' ? '' : ` ${RUN_KIND_LABELS[item.kind]}`}
                {item.isDryRun ? ' DRY-RUN' : ''}
                {item.sourceLabel ? ` / ${item.sourceLabel}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data.total === 0 ? (
        <div className="card g">
          <div className="h2">エラーは、ありません</div>
        </div>
      ) : (
        <SplitView
          items={data.items}
          idOf={(item) => item.errorId}
          selectedParam={url.get('sel')}
          total={data.total}
          limit={data.limit}
          offset={data.offset}
          columns="7fr 5fr"
          noun="エラー"
          header={
            <div className="listhead errhead" aria-hidden="true">
              <span>コード</span>
              <span>ファイル</span>
              <span>実行 / 日時</span>
            </div>
          }
          renderItem={(item, active, select) => (
            <Button
              block
              selected={active}
              className="errcard"
              onClick={select}
            >
              <span className="chip r">{item.code}</span>
              <span
                className="mono errcard-path"
                title={describeSource(item.source)}
              >
                {shortenSource(item.source)}
              </span>
              <span className="mono errcard-side">
                <span>#{item.runId}</span>
                <span>{formatDateTimeSeconds(item.occurredAt)}</span>
              </span>
            </Button>
          )}
          detail={(item) => <ErrorDetail id={item.errorId} />}
        />
      )}
    </RevealPage>
  );
}
