import { epochToLocalParts } from '@file-seiri/core';
import type { EventRecord } from '@file-seiri/ledger';

const pad = (value: number | undefined): string =>
  String(value ?? 0).padStart(2, '0');

/** UTC の ISO 8601 を、指定のタイムゾーンの `YYYY-MM-DD HH:MM:SS` にする */
export const formatLocalTime = (iso: string, timeZone: string): string => {
  const parts = epochToLocalParts(Date.parse(iso), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
};

const COLORS: Record<EventRecord['level'], string | undefined> = {
  DEBUG: '90', // 灰
  INFO: undefined,
  WARN: '33', // 黄
  ERROR: '31', // 赤
};

export type LineStyle = {
  timeZone: string;
  /** true なら、レベルに色を付ける(端末のときだけ。`NO_COLOR` では、使わない) */
  color: boolean;
};

/**
 * ログの 1 行: `時刻 レベル #実行 コード メッセージ`(仕様書 §13、`cli-logging.md` §6)。
 * 画面の制御文字は、色を付けるときだけ(端末でないときは、含めない)。
 */
export const formatEventLine = (
  event: EventRecord,
  style: LineStyle
): string => {
  const level = event.level.padEnd(5);
  const color = style.color ? COLORS[event.level] : undefined;
  const coloredLevel = color ? `\u001b[${color}m${level}\u001b[0m` : level;
  return `${formatLocalTime(event.occurredAt, style.timeZone)} ${coloredLevel} #${event.runId} ${event.code} ${event.message}`;
};
