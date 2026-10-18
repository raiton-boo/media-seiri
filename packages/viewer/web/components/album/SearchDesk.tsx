import type { SearchPhotosResponse } from '../../../src/api-types.ts';
import { formatClip } from '../../lib/album';
import { formatCount } from '../../lib/format';
import { RevealDesk } from '../motion/Reveal';
import { Polaroid, photoCaption } from './Polaroid';

/**
 * 検索結果の机: 合った写真のうち、代表の枚数だけを、3 列の格子に広げる。「もっと広げる」で、増やす。
 * 全部は、「すべて」(一覧)で見る。
 */
export function SearchDesk({
  data,
  onMore,
}: {
  data: SearchPhotosResponse;
  onMore: () => void;
}) {
  if (data.total === 0) {
    return (
      <div className="card">
        <div className="h2">条件に合う写真は、ありません</div>
      </div>
    );
  }
  const shown = data.photos.length;
  return (
    <RevealDesk className="desk deskgrid c3">
      <div
        className="stk"
        style={{
          left: 36,
          top: 24,
          transform: 'rotate(-2deg)',
          fontSize: 16,
          padding: '6px 16px',
          boxShadow: 'var(--sh)',
        }}
      >
        {formatCount(data.total)} 枚のうち、代表の {formatCount(shown)} 枚
      </div>
      {data.photos.map((photo, index) => (
        <Polaroid
          key={photo.libraryFileId}
          photo={photo}
          index={index}
          caption={photoCaption(photo, formatClip)}
        />
      ))}
      {data.total > shown ? (
        <button
          type="button"
          className="stk"
          style={{
            right: 36,
            bottom: 22,
            transform: 'rotate(-2deg)',
            background: 'var(--b)',
          }}
          onClick={onMore}
        >
          もっと広げる(+12)↓
        </button>
      ) : null}
    </RevealDesk>
  );
}
