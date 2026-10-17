/** 実行・記録の時刻(`*_at`)の形。UTC の ISO 8601(例: `2026-10-18T00:00:00.000Z`) */
export const formatTimestamp = (date: Date): string => {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('時刻が不正です(Invalid Date)');
  }
  return date.toISOString();
};
