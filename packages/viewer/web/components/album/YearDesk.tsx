import type { AlbumYearResponse } from '../../../src/api-types.ts';
import { stickerColor } from '../../lib/album';
import { albumHref } from '../../lib/album-url';
import { formatCount } from '../../lib/format';
import { RevealDesk } from '../motion/Reveal';
import { Polaroid } from './Polaroid';

/**
 * 年の机: 月ごとの代表の 1 枚だけを置く。いちばん多い月は、大きく(2 列 × 2 行)。
 * 月の写真を押すと、その月の机へ。枚数のない月は、置かない。
 */
export function YearDesk({ data }: { data: AlbumYearResponse }) {
  const months = data.months.filter((item) => item.cover !== null);
  const biggest = months.reduce<number>(
    (best, item) => Math.max(best, item.count),
    0
  );
  const bigMonth = months.find((item) => item.count === biggest)?.month;

  if (months.length === 0) {
    return (
      <div className="card g">
        <div className="h2">この年の写真は、ありません</div>
      </div>
    );
  }
  return (
    <RevealDesk key={`${data.year}|${data.order}`} className="desk deskgrid">
      <div
        className="stk"
        style={{
          left: 40,
          top: 26,
          transform: 'rotate(-2deg)',
          fontSize: 20,
          padding: '8px 18px',
          boxShadow: 'var(--sh)',
        }}
      >
        {data.year} 年 ／ {formatCount(data.total)} 枚
      </div>
      {months.map((item, index) =>
        item.cover ? (
          <Polaroid
            key={item.month}
            photo={item.cover}
            index={index}
            big={item.month === bigMonth}
            caption={[
              `${formatCount(item.count)} 枚`,
              item.month === bigMonth ? '最多' : '',
            ]}
            href={albumHref({
              view: 'month',
              y: data.year,
              m: item.month,
              order: data.order,
            })}
          >
            <div
              className="stk"
              style={{
                left: 6,
                top: 6,
                fontFamily: 'var(--disp)',
                fontSize: 24,
                padding: '0 12px',
                background: stickerColor(index),
              }}
            >
              {String(item.month).padStart(2, '0')}
            </div>
          </Polaroid>
        ) : null
      )}
      <div
        className="stk"
        style={{
          right: 44,
          bottom: 22,
          transform: 'rotate(-2deg)',
          background: 'var(--b)',
        }}
      >
        月を押すと、その月の机へ ↓
      </div>
    </RevealDesk>
  );
}
