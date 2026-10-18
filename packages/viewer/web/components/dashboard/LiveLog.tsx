'use client';

import { formatDateTimeSeconds } from '../../lib/format';
import { useLive } from '../../lib/live';

const SHOWN = 8;

const LEVEL_CLASS: Record<string, string> = {
  INFO: 'chip',
  WARN: 'chip o',
  ERROR: 'chip r',
};

/** 実行中の、直近のログ(リアルタイム。新しいものが、下)。つながっていなければ、何も出さない */
export function LiveLog() {
  const { logs, connected } = useLive();
  const recent = logs.slice(-SHOWN);
  return (
    <div className="flex flex-col gap-2" data-motion="block">
      <div className="flex items-center justify-between">
        <div className="kicker">直近のログ</div>
        <div className="mono" style={{ fontSize: 12 }}>
          {connected ? 'リアルタイムで更新中' : '2 秒ごとに更新'}
        </div>
      </div>
      {recent.length === 0 ? (
        <div className="mono muted" style={{ fontSize: 13 }}>
          まだ、ログは、ありません
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {recent.map((event) => (
            <li
              key={event.eventId}
              className="mono flex items-baseline gap-2"
              style={{ fontSize: 13 }}
            >
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {formatDateTimeSeconds(event.occurredAt)}
              </span>
              <span className={LEVEL_CLASS[event.level] ?? 'chip'}>
                {event.level}
              </span>
              <span
                title={event.message}
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {event.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
