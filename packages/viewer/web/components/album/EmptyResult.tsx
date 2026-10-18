'use client';

import {
  EMPTY_FILTER,
  type FilterState,
  isFiltered,
  removeLastCondition,
} from '../../lib/album-filter';
import { Button } from '../Button';

/**
 * 条件に合う写真がないときの案内。条件(上の札)を、1 つずつ外して、結果が出るところまで戻れる。すべてクリアも。
 * 条件がなければ(写真が、そもそもないとき)、ボタンは出さない。
 */
export function EmptyResult({
  filter,
  onChange,
  title = '条件に合う写真は、0 件',
}: {
  filter: FilterState;
  onChange: (next: FilterState) => void;
  title?: string;
}) {
  return (
    <div
      className="card flex flex-col items-start justify-center gap-3"
      style={{ minHeight: 160 }}
    >
      <div className="h2">{title}</div>
      {isFiltered(filter) ? (
        <>
          <div className="mono" style={{ fontSize: 13 }}>
            条件を外すと、見つかるかもしれません。
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="y"
              onClick={() => onChange(removeLastCondition(filter))}
            >
              条件を 1 つずつ外す
            </Button>
            <Button onClick={() => onChange(EMPTY_FILTER)}>すべてクリア</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
