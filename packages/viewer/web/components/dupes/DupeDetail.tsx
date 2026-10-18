'use client';

import { thumbUrl, useDupeDetail } from '../../lib/api';
import {
  baseName,
  describeLocation,
  formatBytes,
  formatDateTime,
} from '../../lib/format';
import { RevealDetail } from '../motion/Reveal';

/** サムネイル(なければ、ファイル名の札だけ)。`skipped` なら、グレーにして、斜めの線を引く */
function Picture({
  thumbRelPath,
  label,
  skipped = false,
}: {
  thumbRelPath: string | null;
  label: string;
  skipped?: boolean;
}) {
  return (
    <div className={skipped ? 'cmp-pic is-skipped' : 'cmp-pic'}>
      <div className="ph c1" style={{ aspectRatio: '16/10' }}>
        {thumbRelPath ? (
          <img
            src={thumbUrl(thumbRelPath)}
            alt={label}
            loading="lazy"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : null}
        <div className="lb">
          {thumbRelPath ? label : `${label} — サムネイルなし`}
        </div>
      </div>
      {skipped ? <div className="cmp-cross" aria-hidden="true" /> : null}
    </div>
  );
}

/** 重複 1 グループの比較: 採用側と、スキップ側(1 つ目)を、並べる。下に、スキップした全部 */
export function DupeDetail({ id }: { id: number }) {
  const { data, isPending, isError } = useDupeDetail(id);
  if (isError)
    return <div className="card note">比較を読み込めませんでした。</div>;
  if (isPending) {
    return (
      <div
        className="sk"
        style={{ height: 520 }}
        role="status"
        aria-label="読み込み中"
      />
    );
  }
  const { adopted, skipped } = data;
  const first = skipped[0];
  const camera = [adopted.cameraMake, adopted.cameraModel]
    .filter(Boolean)
    .join(' ');
  return (
    <RevealDetail className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">比較</h2>
        <span className="chip g">
          <span className="dot" aria-hidden="true" />
          ハッシュ一致 / 1 バイトも違わない
        </span>
      </div>
      <div className="cmp-grid">
        <div
          className="card cmp-card cmp-adopted flex flex-col gap-3"
          data-motion="detail-item"
        >
          <span className="cmp-stamp cmp-stamp-ok">✓ 採用</span>
          <span className="chip on" style={{ alignSelf: 'flex-start' }}>
            採用 / ADOPTED
          </span>
          <Picture
            thumbRelPath={adopted.thumbRelPath}
            label={baseName(adopted.relPath)}
          />
          <div
            className="mono"
            style={{ fontSize: 13, lineHeight: 1.8, wordBreak: 'break-all' }}
          >
            場所 {adopted.relPath}
            <br />
            サイズ {formatBytes(adopted.sizeBytes)}
            <br />
            撮影 {adopted.takenAt ?? '日付なし'}
            {adopted.dateSource ? ` (${adopted.dateSource})` : ''}
            <br />
            カメラ {camera || '—'}
            <br />
            取り込み run #{adopted.runId}
          </div>
        </div>
        <div className="cmp-mid" aria-hidden="true">
          <span className="cmp-eq">＝</span>
          <span className="chip g">ハッシュ一致</span>
        </div>
        <div
          className="card cmp-card cmp-skipped flex flex-col gap-3"
          data-motion="detail-item"
        >
          <span className="cmp-stamp cmp-stamp-no">
            ✗ スキップ ×{skipped.length}
          </span>
          <span className="chip" style={{ alignSelf: 'flex-start' }}>
            スキップ / SKIPPED
          </span>
          <Picture
            thumbRelPath={adopted.thumbRelPath}
            label={first ? baseName(first.relPath) : '—'}
            skipped
          />
          <div
            className="mono"
            style={{ fontSize: 13, lineHeight: 1.8, wordBreak: 'break-all' }}
          >
            場所 {first ? describeLocation(first, false) : '—'}
            <br />
            サイズ {first ? formatBytes(first.sizeBytes) : '—'}
            <br />
            更新日{' '}
            {first
              ? formatDateTime(new Date(first.mtimeMs).toISOString())
              : '—'}
            <br />
            スキップ run #{first?.runId ?? '—'}
            <br />
            <b>→ ライブラリへは、コピーしていない</b>
          </div>
        </div>
      </div>
      <div className="card s bg" data-motion="detail-item">
        <div className="kicker" style={{ marginBottom: 6 }}>
          スキップした {skipped.length} 件(同じ内容)
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>元の場所</th>
              <th>実行</th>
            </tr>
          </thead>
          <tbody>
            {skipped.map((item) => (
              <tr key={item.sourceFileId}>
                <td className="m" style={{ wordBreak: 'break-all' }}>
                  {describeLocation(item, false)}
                </td>
                <td className="m nw">
                  #{item.runId}
                  {item.isDryRun ? ' DRY-RUN' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RevealDetail>
  );
}
