'use client';

import type { GroupMember } from '@file-seiri/ledger';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlbumFilterProvider, useAlbumHref } from '../../lib/album-context';
import { EMPTY_FILTER, readFilter } from '../../lib/album-filter';
import { placeValue } from '../../lib/album-search';
import {
  originalUrl,
  thumbUrl,
  usePhotoDetail,
  usePhotoStrip,
  useSameDay,
  useViewerInfo,
} from '../../lib/api';
import { formatBytes, formatCount } from '../../lib/format';
import { formatPhotoDate, placeCell, viewKindOf } from '../../lib/photo';
import { useUrlState } from '../../lib/query-state';
import { Button } from '../Button';
import { LoadError } from '../motion/LoadError';

// 地図は、重いので、GPS のある写真を開いたときだけ読み込む
const MiniMap = dynamic(() => import('./MiniMap').then((m) => m.MiniMap), {
  ssr: false,
});

const KIND_LABELS: Record<string, string> = {
  photo: '写真',
  video: '動画',
  raw: 'RAW',
  xmp: 'XMP',
  json: 'JSON',
  unsupported: 'その他',
};

const extensionLabel = (member: GroupMember): string => {
  const extension = member.relPath.split('.').pop()?.toUpperCase() ?? '';
  return member.kind === 'raw' ? `${extension} (RAW)` : extension;
};

const nameOf = (relPath: string): string => relPath.split('/').pop() ?? relPath;

/** 画面の主役の 1 枚(または動画)。原本が読めなければ、サムネイル */
function Stage({
  member,
  fromSource,
  sourceLabel,
  libraryName,
}: {
  member: GroupMember;
  /** ライブラリの原本がなく、ソース側のコピーを見せている */
  fromSource: boolean;
  sourceLabel: string | null;
  libraryName: string;
}) {
  const viewKind = viewKindOf(member.relPath);
  // 原本が読めなかった(ドライブが外れている・形式が違う)ときは、サムネイルに切り替える
  const [failed, setFailed] = useState(false);
  const useOriginal = viewKind !== null && !failed;
  if (useOriginal) {
    return (
      <>
        {viewKind === 'video' ? (
          // biome-ignore lint/a11y/useMediaCaption: 家族の動画。字幕は、ない
          <video
            key={member.libraryFileId}
            className="vw-media"
            src={originalUrl(member.libraryFileId)}
            controls
            autoPlay
            playsInline
            poster={
              member.thumbRelPath ? thumbUrl(member.thumbRelPath) : undefined
            }
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            key={member.libraryFileId}
            draggable={false}
            className="vw-media"
            src={originalUrl(member.libraryFileId)}
            alt={nameOf(member.relPath)}
            onError={() => setFailed(true)}
          />
        )}
        {fromSource ? (
          <div className="vw-note chip o">
            ソース側のコピーを表示中{sourceLabel ? `(${sourceLabel})` : ''}—
            ライブラリの「{libraryName}」は、接続されていません
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      {member.thumbRelPath ? (
        <img
          draggable={false}
          className="vw-media"
          src={thumbUrl(member.thumbRelPath)}
          alt={nameOf(member.relPath)}
        />
      ) : (
        <div className="vw-empty mono">
          {nameOf(member.relPath)} — 見せられる画像がありません
        </div>
      )}
      <div className="vw-note chip o">
        {viewKind === null
          ? 'この形式は、ブラウザで表示できないため、サムネイルを表示中'
          : `原本を読み込めないため、サムネイルを表示中(「${libraryName}」のドライブを、接続してください)`}
      </div>
    </>
  );
}

/** 拡大表示: 前後の写真(← →)・フィルムストリップ・情報の引き出し・同名グループの切り替え。閲覧専用 */
export function PhotoViewer() {
  const url = useUrlState();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const id = Number(url.get('p')) || undefined;
  const order = url.get('order') === 'old' ? 'old' : 'new';
  const eventId = Number(url.get('e')) || undefined;
  const filter = readFilter(url.getAll);
  const drawer = url.get('drawer') === '1';
  const albumHref = useAlbumHref();
  const [info, setInfo] = useState(true);
  // 同名グループで、いま見ているファイル(既定は、この写真。写真が変わったら、戻す)
  const [memberId, setMemberId] = useState<number | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 写真が変わったら、グループの選択を戻す
  useEffect(() => setMemberId(undefined), [id]);

  const detail = usePhotoDetail(id);
  const sameDay = useSameDay(id);
  const viewerInfo = useViewerInfo();
  const strip = usePhotoStrip(id, order, filter, eventId);

  const stripPhotos = strip.data?.photos ?? [];
  const index = stripPhotos.findIndex((photo) => photo.libraryFileId === id);
  const before = index > 0 ? stripPhotos[index - 1] : undefined;
  const after = index >= 0 ? stripPhotos[index + 1] : undefined;
  const go = useCallback(
    (target: number | undefined) => {
      if (target !== undefined) url.set({ p: String(target) });
    },
    [url]
  );

  // 閉じる: 来た画面へ戻る(履歴がなければ、アルバムの入口)
  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(albumHref());
  }, [router, albumHref]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if (event.key === 'ArrowLeft') go(before?.libraryFileId);
      else if (event.key === 'ArrowRight') go(after?.libraryFileId);
      else if (event.key === 'Escape' && !document.fullscreenElement) close();
      else if (event.key === 'i') setInfo((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, before, after, close]);

  if (id === undefined || detail.isError) {
    return (
      <div className="page">
        <LoadError>写真を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!detail.data) {
    return <div className="viewer" role="status" aria-label="読み込み中" />;
  }
  const { photo } = detail.data;
  const members = photo.group;
  const shown = members.find((member) => member.libraryFileId === memberId) ??
    members.find((member) => member.libraryFileId === photo.libraryFileId) ?? {
      libraryFileId: photo.libraryFileId,
      relPath: photo.relPath,
      kind: photo.kind,
      thumbRelPath: photo.thumbRelPath,
      sizeBytes: photo.sizeBytes,
    };
  const position = strip.data?.position ?? null;
  const total = strip.data?.total ?? 0;
  const scope = eventId ? 'できごと' : '全体';
  const place = detail.data.place;
  // 近い地名があれば、その地名の写真。なければ、座標のまとまり(0.1 度)の写真
  const placeHref = photo.gps
    ? albumHref({
        view: 'search',
        filter: {
          ...EMPTY_FILTER,
          ...(place
            ? { areas: [place.ref] }
            : {
                places: [
                  placeValue({
                    lat: placeCell(photo.gps.lat),
                    lon: placeCell(photo.gps.lon),
                  }),
                ],
              }),
        },
        drawer: false,
      })
    : undefined;

  return (
    <AlbumFilterProvider filter={filter} drawer={drawer}>
      <div className="viewer" ref={root}>
        <div className="vw-bar">
          <Button variant="y" onClick={close}>
            ✕ 閉じる
          </Button>
          <div className="mono vw-title">
            {formatPhotoDate(photo.takenAt)}
            {position ? (
              <span className="vw-dim">
                {' '}
                ／ {scope} {formatCount(total)} 枚中 {formatCount(position)}{' '}
                枚目
              </span>
            ) : null}
          </div>
          <div className="vw-actions">
            <Button
              href={albumHref({
                view: 'slide',
                p: photo.libraryFileId,
                e: eventId,
                order,
              })}
            >
              ▶ スライドショー
            </Button>
            <Button
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void root.current?.requestFullscreen();
              }}
            >
              ⤢ 全画面
            </Button>
            <Button
              variant={info ? 'ink' : 'default'}
              selected={info}
              onClick={() => setInfo((open) => !open)}
            >
              ⓘ 情報
            </Button>
          </div>
        </div>

        <div
          className="vw-body"
          style={{
            gridTemplateColumns: info ? 'minmax(0,1fr) 340px' : 'minmax(0,1fr)',
          }}
        >
          <div className="vw-main">
            <div className="vw-stage">
              <Stage
                key={shown.libraryFileId}
                member={shown}
                fromSource={detail.data.original.from === 'source'}
                sourceLabel={detail.data.original.sourceLabel}
                libraryName={viewerInfo.data?.library.name ?? 'ライブラリ'}
              />
              <button
                type="button"
                className="vw-nav l"
                aria-label="前の写真"
                disabled={!before}
                onClick={() => go(before?.libraryFileId)}
              >
                ←
              </button>
              <button
                type="button"
                className="vw-nav r"
                aria-label="次の写真"
                disabled={!after}
                onClick={() => go(after?.libraryFileId)}
              >
                →
              </button>
              <div className="vw-badges">
                <span className="chip">{extensionLabel(shown)}</span>
                {photo.gps ? <span className="chip g">GPS</span> : null}
              </div>
            </div>

            <div className="vw-group">
              {members.length > 1
                ? members.map((member) => (
                    <button
                      key={member.libraryFileId}
                      type="button"
                      className={`chip${member.libraryFileId === shown.libraryFileId ? ' y' : ' vw-ghost'}`}
                      aria-pressed={
                        member.libraryFileId === shown.libraryFileId
                      }
                      onClick={() => setMemberId(member.libraryFileId)}
                    >
                      {extensionLabel(member)}
                    </button>
                  ))
                : null}
              <span className="mono vw-hint">
                {members.length > 1
                  ? `同名グループ ${members.length} ファイル ／ `
                  : ''}
                ← → で前後 ／ i で情報 ／ Esc で閉じる
              </span>
            </div>

            <ul className="vw-strip">
              {stripPhotos.map((item) => (
                <li key={item.libraryFileId}>
                  <button
                    type="button"
                    className={`vw-thumb${item.libraryFileId === id ? ' on' : ''}`}
                    aria-label={nameOf(item.relPath)}
                    aria-current={item.libraryFileId === id}
                    onClick={() => go(item.libraryFileId)}
                    ref={(element) => {
                      if (element && item.libraryFileId === id)
                        element.scrollIntoView({
                          inline: 'center',
                          block: 'nearest',
                        });
                    }}
                  >
                    {item.thumbRelPath ? (
                      <img
                        draggable={false}
                        src={thumbUrl(item.thumbRelPath)}
                        alt=""
                        style={{
                          aspectRatio:
                            item.width && item.height
                              ? String(item.width / item.height)
                              : '4 / 3',
                        }}
                      />
                    ) : (
                      <span className="mono">{nameOf(item.relPath)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {info ? (
            <aside className="vw-info" aria-label="情報">
              <div className="h2">情報</div>
              <div className="card s flex flex-col gap-1">
                <div className="kicker">撮影日時</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 16 }}>
                  {photo.takenAt ? photo.takenAt.replace('T', ' ') : '日付なし'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {photo.dateSource ? (
                    <span className="chip g">
                      {photo.dateSource.toUpperCase()}
                    </span>
                  ) : null}
                  {photo.datePrecision ? (
                    <span className="chip">精度 {photo.datePrecision}</span>
                  ) : null}
                </div>
              </div>
              <div
                className="card s mono"
                style={{ fontSize: 13, lineHeight: 1.9 }}
              >
                カメラ{' '}
                {[photo.cameraMake, photo.cameraModel]
                  .filter(Boolean)
                  .join(' ') || '不明'}
                <br />
                {photo.lensModel ? (
                  <>
                    レンズ {photo.lensModel}
                    <br />
                  </>
                ) : null}
                {photo.width && photo.height
                  ? `寸法 ${photo.width} × ${photo.height} ／ `
                  : ''}
                {formatBytes(photo.sizeBytes)}
                <br />
                種別 {KIND_LABELS[photo.kind] ?? photo.kind}
                {photo.isRepaired ? ' ／ 修復済み' : ''}
                <br />
                SHA-256 {photo.hash.slice(0, 8)}…{photo.hash.slice(-4)}
              </div>
              <div className="card s">
                <div className="kicker">PATH</div>
                <div
                  className="mono"
                  style={{ fontSize: 13, wordBreak: 'break-all' }}
                >
                  {shown.relPath}
                </div>
              </div>
              {photo.gps ? (
                <div className="card s flex flex-col gap-2">
                  <div className="kicker">GPS</div>
                  {place ? (
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {place.label} 付近
                    </div>
                  ) : null}
                  <div className="mono" style={{ fontSize: 13 }}>
                    {photo.gps.lat.toFixed(4)}, {photo.gps.lon.toFixed(4)}
                  </div>
                  <MiniMap lat={photo.gps.lat} lon={photo.gps.lon} />
                </div>
              ) : null}
              {sameDay.data && sameDay.data.years.length > 0 ? (
                <div className="card s flex flex-col gap-2">
                  <div className="kicker">
                    この日の他の年
                    {sameDay.data.monthDay
                      ? ` ／ ${Number(sameDay.data.monthDay.slice(0, 2))}月${Number(sameDay.data.monthDay.slice(3))}日`
                      : ''}
                  </div>
                  <div className="sd-list">
                    {sameDay.data.years.map((item) => (
                      <Link
                        key={item.year}
                        className="sd-item"
                        draggable={false}
                        href={albumHref({
                          view: 'search',
                          filter: {
                            ...EMPTY_FILTER,
                            dates: [`${item.year}-${sameDay.data.monthDay}`],
                          },
                          drawer: false,
                        })}
                      >
                        {item.thumbRelPath ? (
                          <img
                            draggable={false}
                            src={thumbUrl(item.thumbRelPath)}
                            alt=""
                          />
                        ) : (
                          <span className="sd-none mono">なし</span>
                        )}
                        <span className="mono" style={{ fontSize: 13 }}>
                          {item.year}年 ／ {formatCount(item.count)} 枚
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              <div
                className="card p flex flex-col gap-2"
                style={{ padding: 12 }}
              >
                <div className="kicker">もっと見る</div>
                {placeHref ? (
                  <Button block href={placeHref}>
                    <span>
                      {place ? `${place.label} の写真` : 'この場所の写真'}
                    </span>
                    <span>→</span>
                  </Button>
                ) : null}
                {photo.event ? (
                  <Button
                    block
                    href={albumHref({
                      view: 'event',
                      e: photo.event.albumEventId,
                      order,
                    })}
                  >
                    <span>
                      同じできごと ／ {formatCount(photo.event.fileCount)}
                    </span>
                    <span>→</span>
                  </Button>
                ) : null}
                {!placeHref && !photo.event ? (
                  <div className="mono" style={{ fontSize: 13 }}>
                    つなげる場所・できごとが、ありません
                  </div>
                ) : null}
              </div>
              <div className="note" style={{ fontSize: 13 }}>
                閲覧専用。削除・移動・名前の変更は、できません。
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </AlbumFilterProvider>
  );
}
