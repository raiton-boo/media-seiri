import { formatCount } from '../lib/format';
import { Button } from './Button';

/** ページ送り: 「1–50 / 1,150 件」と、前へ・次へ */
export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="mono" style={{ fontSize: 12 }}>
        {formatCount(from)}–{formatCount(to)} / {formatCount(total)} 件
      </span>
      <div className="flex gap-2">
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
