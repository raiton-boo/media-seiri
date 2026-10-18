'use client';

import type { AlbumPhoto } from '@file-seiri/ledger';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clockOf, parseTakenAt, weekdayOf } from '../../lib/album';
import { AlbumFilterProvider, useAlbumHref } from '../../lib/album-context';
import { readFilter } from '../../lib/album-filter';
import { originalUrl, thumbUrl, useSlideshow } from '../../lib/api';
import { formatCount } from '../../lib/format';
import { viewKindOf } from '../../lib/photo';
import { useUrlState } from '../../lib/query-state';
import {
  nextSpeed,
  parseSpeed,
  progressOf,
  shuffled,
} from '../../lib/slideshow';
import { Button } from '../Button';
import { LoadError } from '../motion/LoadError';

/** 時計の刻み(ms)。進みの棒を、なめらかに動かす */
const TICK_MS = 100;

const nameOf = (relPath: string): string => relPath.split('/').pop() ?? relPath;

/** 付箋の日付(`2014年4月6日(日) 15:33`)。日付がなければ、「日付なし」 */
const stickerDate = (takenAt: string | null): string => {
  const parts = takenAt ? parseTakenAt(takenAt) : undefined;
  if (!parts) return takenAt ?? '日付なし';
  const clock = clockOf(takenAt);
  return `${parts.year}年${parts.month}月${parts.day}日(${weekdayOf(parts.year, parts.month, parts.day)})${clock ? ` ${clock}` : ''}`;
};

type StageProps = {
  photo: AlbumPhoto;
  playing: boolean;
  /** 動画を再生している間は、時計を止める(再生を終えてから、次へ) */
  onHold: (hold: boolean) => void;
  onProgress: (ratio: number) => void;
  onEnded: () => void;
};

/** 舞台の 1 枚。写真は、原本(読めなければ、サムネイル)。動画は、再生を終えるまで待つ */
function Stage({ photo, playing, onHold, onProgress, onEnded }: StageProps) {
  const kind = viewKindOf(photo.relPath);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const isVideo = kind === 'video' && !failed;

  useEffect(() => {
    onHold(isVideo);
    return () => onHold(false);
  }, [isVideo, onHold]);
  // 止めたら、動画も止める。再開したら、続きから
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (playing) void element.play().catch(() => undefined);
    else element.pause();
  }, [playing]);

  if (isVideo) {
    return (
      <video
        ref={video}
        className="ss-media"
        src={originalUrl(photo.libraryFileId)}
        poster={photo.thumbRelPath ? thumbUrl(photo.thumbRelPath) : undefined}
        // 自動再生は、音を出さないものだけ、ブラウザが許す
        muted
        autoPlay={playing}
        playsInline
        onTimeUpdate={(event) => {
          const { currentTime, duration } = event.currentTarget;
          if (duration > 0) onProgress(currentTime / duration);
        }}
        onEnded={onEnded}
        onError={() => setFailed(true)}
      />
    );
  }
  const useOriginal = kind === 'image' && !failed;
  const source = useOriginal
    ? originalUrl(photo.libraryFileId)
    : photo.thumbRelPath
      ? thumbUrl(photo.thumbRelPath)
      : undefined;
  return source ? (
    <img
      draggable={false}
      className="ss-media"
      src={source}
      alt={nameOf(photo.relPath)}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="mono" style={{ padding: 24 }}>
      {nameOf(photo.relPath)} — 見せられる画像がありません
    </div>
  );
}

/**
 * スライドショー: 条件に合う写真を、順に見せる。速度・順序(新しい順 / 古い順 / シャッフル)を選べる。
 * Space で停止・再開、← → で前後、Esc で終了。動画は、再生を終えてから次へ。最後まで見たら、止まる。
 */
export function Slideshow() {
  const url = useUrlState();
  const router = useRouter();
  const albumHref = useAlbumHref();
  const order = url.get('order') === 'old' ? 'old' : 'new';
  const shuffle = url.get('shuffle') === '1';
  const speed = parseSpeed(url.get('speed'));
  const eventId = Number(url.get('e')) || undefined;
  const filter = readFilter(url.getAll);
  const startId = Number(url.get('p')) || undefined;

  const { data, isError } = useSlideshow(order, filter, eventId);
  // シャッフルの種(この画面を開いている間は、同じ並び)
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const list = useMemo(
    () => (data ? (shuffle ? shuffled(data.photos, seed) : data.photos) : []),
    [data, shuffle, seed]
  );

  const [currentId, setCurrentId] = useState<number | undefined>(startId);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [videoHold, setVideoHold] = useState(false);
  const [videoRatio, setVideoRatio] = useState(0);

  const found = list.findIndex((photo) => photo.libraryFileId === currentId);
  const index = found >= 0 ? found : 0;
  const photo = list[index];
  const last = list.length - 1;

  const goTo = useCallback(
    (target: number) => {
      const next = list[target];
      if (!next) return;
      setCurrentId(next.libraryFileId);
      setElapsed(0);
      setVideoRatio(0);
      setFinished(false);
    },
    [list]
  );
  const forward = useCallback(() => {
    if (index >= last) {
      // 最後まで見た: 止めて、知らせる
      setPlaying(false);
      setFinished(true);
    } else goTo(index + 1);
  }, [index, last, goTo]);
  const back = useCallback(() => goTo(Math.max(index - 1, 0)), [index, goTo]);
  const toggle = useCallback(() => {
    // 最後まで見たあとの再生は、最初から
    if (finished) {
      goTo(0);
      setPlaying(true);
    } else setPlaying((value) => !value);
  }, [finished, goTo]);

  // 時計: 再生中で、動画を再生していないときだけ進む。1 枚の長さに届いたら、次へ
  const duration = speed * 1000;
  useEffect(() => {
    if (!playing || videoHold || !photo) return;
    const timer = setInterval(
      () => setElapsed((value) => value + TICK_MS),
      TICK_MS
    );
    return () => clearInterval(timer);
  }, [playing, videoHold, photo]);
  useEffect(() => {
    if (elapsed >= duration) forward();
  }, [elapsed, duration, forward]);

  // 次の写真を、先に読んでおく
  const upcoming = list.slice(index + 1, index + 9);
  const preload = upcoming[0];
  useEffect(() => {
    if (preload && viewKindOf(preload.relPath) === 'image') {
      new Image().src = originalUrl(preload.libraryFileId);
    }
  }, [preload]);

  const close = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(albumHref());
  }, [router, albumHref]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
        return;
      if (event.key === ' ') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'ArrowLeft') back();
      else if (event.key === 'ArrowRight') forward();
      else if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, back, forward, close]);

  if (isError) {
    return (
      <div className="page">
        <LoadError>スライドショーを読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!data)
    return <div className="viewer" role="status" aria-label="読み込み中" />;
  if (!photo) {
    return (
      <div className="viewer">
        <div className="vw-bar">
          <Button variant="y" onClick={close}>
            ✕ 終了
          </Button>
        </div>
        <div className="page">
          <div className="card">
            <div className="h2">見せる写真が、ありません</div>
          </div>
        </div>
      </div>
    );
  }

  const progress = videoHold
    ? videoRatio
    : finished
      ? 1
      : progressOf(elapsed, duration);

  return (
    <AlbumFilterProvider filter={filter} drawer={false}>
      <div className="viewer">
        <div className="vw-bar">
          <Button variant="y" onClick={close}>
            ✕ 終了
          </Button>
          <div className="mono vw-title">
            スライドショー
            <span className="vw-dim">
              {eventId ? ' ／ できごとの中' : ' ／ 条件に合う写真'}
              {data.total > data.photos.length
                ? `(先頭の ${formatCount(data.photos.length)} 枚)`
                : ''}
            </span>
          </div>
          <div className="vw-actions">
            <button
              type="button"
              className="chip y"
              disabled={shuffle}
              aria-pressed={!shuffle}
              onClick={() =>
                url.set({ order: order === 'new' ? 'old' : undefined })
              }
            >
              {order === 'new' ? '新しい順' : '古い順'}
            </button>
            <button
              type="button"
              className={shuffle ? 'chip y' : 'chip vw-ghost'}
              aria-pressed={shuffle}
              onClick={() => url.set({ shuffle: shuffle ? undefined : '1' })}
            >
              シャッフル
            </button>
            <button
              type="button"
              className="chip vw-ghost"
              onClick={() => {
                const next = nextSpeed(speed);
                url.set({ speed: next === 3 ? undefined : String(next) });
              }}
            >
              {speed} 秒 ▾
            </button>
          </div>
        </div>

        <div className="ss-stage">
          <button
            type="button"
            className="vw-nav l"
            aria-label="前の写真"
            disabled={index === 0}
            onClick={back}
          >
            ←
          </button>
          <button
            type="button"
            className="vw-nav r"
            aria-label="次の写真"
            disabled={index >= last}
            onClick={forward}
          >
            →
          </button>
          <div className="ss-frame">
            <Stage
              key={photo.libraryFileId}
              photo={photo}
              playing={playing}
              onHold={setVideoHold}
              onProgress={setVideoRatio}
              onEnded={forward}
            />
            <div
              className="stk"
              style={{
                left: -18,
                bottom: -14,
                fontSize: 20,
                padding: '6px 18px',
                transform: 'rotate(-2deg)',
                boxShadow: 'var(--sh)',
                color: 'var(--ink)',
              }}
            >
              {stickerDate(photo.takenAt)}
            </div>
            <div
              className="stk"
              style={{
                right: -14,
                top: -14,
                transform: 'rotate(2deg)',
                background: 'var(--p)',
                color: 'var(--ink)',
              }}
            >
              {formatCount(index + 1)} / {formatCount(list.length)}
            </div>
          </div>
        </div>

        <div className="ss-controls">
          <div
            className="ss-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="この写真の進み"
          >
            <div style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-3">
              <Button
                ariaLabel="前の写真"
                disabled={index === 0}
                onClick={back}
              >
                ⏮
              </Button>
              <Button variant="y" large onClick={toggle}>
                {finished ? '↻ もう一度' : playing ? '⏸ 停止' : '▶ 再生'}
              </Button>
              <Button
                ariaLabel="次の写真"
                disabled={index >= last}
                onClick={forward}
              >
                ⏭
              </Button>
            </div>
            <div className="ss-next">
              {upcoming.map((item, i) => (
                <div
                  key={item.libraryFileId}
                  className="ss-nt"
                  style={{ opacity: Math.max(0.35, 1 - i * 0.1) }}
                >
                  {item.thumbRelPath ? (
                    <img
                      draggable={false}
                      src={thumbUrl(item.thumbRelPath)}
                      alt=""
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <span className="mono vw-hint">
              {finished ? '最後まで見ました ／ ' : ''}
              Space 停止 ／ ← → 前後 ／ Esc 終了
            </span>
          </div>
        </div>
      </div>
    </AlbumFilterProvider>
  );
}
