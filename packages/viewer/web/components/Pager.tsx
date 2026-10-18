import { formatCount } from '../lib/format';
import { Button } from './Button';

/** ページ送り: 「1–50 / 1,150 件」と、前へ・次へ */
export function Pager({
  total,
  limit,
  offset,
  onChange,
  stacked = false,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  /** 狭い欄(左の一覧など)用: 件数を 1 行目、ボタンを 2 行目(左右に半分ずつ)に、縦に並べる(横に並べると、重なる) */
  stacked?: boolean;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div
      className={
        stacked
          ? 'pager-stacked'
          : 'flex flex-wrap items-center justify-between gap-3'
      }
    >
      <span className="mono" style={{ fontSize: 13 }}>
        {formatCount(from)}–{formatCount(to)} / {formatCount(total)} 件
      </span>
      <div className={stacked ? 'pager-buttons' : 'flex gap-2'}>
        <Button
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          ← 前へ
        </Button>
        <Button
          variant="y"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          次へ →
        </Button>
      </div>
    </div>
  );
}
