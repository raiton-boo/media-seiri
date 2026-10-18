'use client';

import { useState } from 'react';
import { parseTakenAt } from '../../lib/album';
import { useAlbumHref } from '../../lib/album-context';
import { albumHref } from '../../lib/album-url';
import { useAlbumMemories } from '../../lib/api';
import { SwapLabel } from '../motion/SwapLabel';
import { Polaroid } from './Polaroid';

/** いまの日付(この PC の時刻)を、`YYYY-MM-DD` にする */
const todayText = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** 思い出す帯の、小さなポラロイドの大きさ */
const SMALL = { position: 'relative', width: 128, height: 124 } as const;

/**
 * 入口の上の帯: 「去年の今日」(今日と同じ月日の、過去の年のできごと。最大 3 件)と、
 * 「今日の一枚」(日付ごとに固定。「別の 1 枚」で、選び直す)。なければ、その札を出さない。
 */
export function Memories() {
  const [date] = useState(todayText);
  const [salt, setSalt] = useState(0);
  const { data } = useAlbumMemories(date, salt);
  const photoHref = useAlbumHref();
  if (!data) return null;
  const [, month, day] = date.split('-');
  const { onThisDay, photoOfDay } = data;
  if (onThisDay.length === 0 && !photoOfDay) return null;

  return (
    <div
      className="grid gap-6"
      style={{
        gridTemplateColumns:
          onThisDay.length > 0 ? 'minmax(0,8fr) minmax(0,4fr)' : '1fr',
      }}
      data-motion="block"
    >
      {onThisDay.length > 0 ? (
        <div
          className="card p flex items-center gap-6"
          style={{ padding: '14px 22px' }}
        >
          <div style={{ minWidth: 150 }}>
            <div className="kicker">
              TODAY {Number(month)}/{Number(day)}
            </div>
            <h2 className="h2">去年の今日</h2>
            <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
              {onThisDay.length} 件のできごと
            </div>
          </div>
          <div className="flex flex-1 justify-end gap-4 pr-1.5">
            {onThisDay.map((item, index) =>
              item.cover ? (
                <Polaroid
                  key={item.albumEventId}
                  photo={item.cover}
                  index={index}
                  motion={false}
                  style={SMALL}
                  caption={[`${parseTakenAt(item.startAt)?.year ?? ''}`, '']}
                  href={albumHref({ view: 'event', e: item.albumEventId })}
                />
              ) : null
            )}
          </div>
        </div>
      ) : null}
      {photoOfDay ? (
        <div
          className="card b flex items-center gap-4"
          style={{ padding: '14px 20px' }}
        >
          <div className="flex-1">
            <div className="kicker">PHOTO OF THE DAY</div>
            <h2 className="h2">今日の一枚</h2>
            <button
              type="button"
              className="chip y"
              style={{ marginTop: 6, cursor: 'pointer' }}
              onClick={() => setSalt((value) => value + 1)}
            >
              <SwapLabel
                active={salt % 2 === 1}
                label="↻ 別の 1 枚"
                activeLabel="↻ 別の 1 枚"
              />
            </button>
          </div>
          <Polaroid
            key={photoOfDay.libraryFileId}
            photo={photoOfDay}
            index={3}
            motion={false}
            style={{ ...SMALL, height: 130 }}
            caption={[photoOfDay.takenAt?.slice(0, 10) ?? '', '']}
            href={photoHref({ view: 'photo', p: photoOfDay.libraryFileId })}
          />
        </div>
      ) : null}
    </div>
  );
}
