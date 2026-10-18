/** 3 桁区切りの数(14,820) */
export const formatCount = (value: number): string =>
  value.toLocaleString('en-US');

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** 容量を、10 進(1 KB = 1000 B。ドライブの表記と同じ)で、値と単位に分ける */
export const splitBytes = (bytes: number): { value: string; unit: string } => {
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < BYTE_UNITS.length - 1) {
    value /= 1000;
    index += 1;
  }
  return {
    value: index === 0 ? String(Math.round(value)) : value.toFixed(1),
    unit: BYTE_UNITS[index] ?? 'B',
  };
};

/** 容量(124.3 GB) */
export const formatBytes = (bytes: number): string => {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
};

/** 撮影日時の文字列(`2013-12-05T10:00:00`・`2024-08`・`2020`)を、年月(2013.12)にする。月がなければ、年だけ */
export const formatPeriodEnd = (takenAt: string): string => {
  const [year, month] = takenAt.split(/[-T]/);
  return month ? `${year}.${month}` : (year ?? takenAt);
};

const pad = (value: number): string => String(value).padStart(2, '0');

/** UTC の ISO 8601 を、この PC の時刻で、`2026-10-10 21:40` にする */
export const formatDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const FILE_SYSTEMS: Record<string, string> = {
  exfat: 'exFAT',
  fat32: 'FAT32',
  fat16: 'FAT16',
  apfs: 'APFS',
  ntfs: 'NTFS',
  hfs: 'HFS+',
};
const MEDIA_KINDS: Record<string, string> = {
  hdd: 'HDD',
  ssd: 'SSD',
  usb: 'USB',
};

/** ライブラリのドライブの説明(`HDD(exFAT)`)。分かる項目だけを使う */
export const describePlace = (
  mediaKind: string | null,
  fsType: string | null
): string | null => {
  const kind = mediaKind ? (MEDIA_KINDS[mediaKind] ?? mediaKind) : null;
  const fs = fsType ? (FILE_SYSTEMS[fsType] ?? fsType) : null;
  if (kind && fs) return `${kind}(${fs})`;
  return kind ?? fs;
};

/** 秒数を `01:05`(1 時間以上は `1:01:05`)にする */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${pad(minutes)}:${pad(rest)}`;
};

export type RunPace = {
  /** 進み(0〜100 の整数) */
  percent: number;
  /** コピーの速さ(バイト/秒)。まだ測れなければ null */
  bytesPerSecond: number | null;
  /** 残りの秒数の見積り。測れなければ null */
  remainingSeconds: number | null;
};

/** 実行中の取り込みの、進み・速さ・残り時間(開始からの平均の速さで見積もる) */
export const estimatePace = (
  progress: {
    startedAt: string;
    total: number;
    done: number;
    plannedBytes: number;
    copiedBytes: number;
  },
  now: Date
): RunPace => {
  const percent =
    progress.total === 0
      ? 0
      : Math.min(100, Math.floor((progress.done / progress.total) * 100));
  const elapsed =
    (now.getTime() - new Date(progress.startedAt).getTime()) / 1000;
  if (elapsed <= 0 || progress.copiedBytes <= 0) {
    return { percent, bytesPerSecond: null, remainingSeconds: null };
  }
  const bytesPerSecond = progress.copiedBytes / elapsed;
  return {
    percent,
    bytesPerSecond,
    remainingSeconds: Math.max(
      0,
      (progress.plannedBytes - progress.copiedBytes) / bytesPerSecond
    ),
  };
};

/** UTC の ISO 8601 を、この PC の時刻で、`10-10 21:58:12`(月日と、秒まで)にする */
export const formatDateTimeSeconds = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * 長いパスを省く: 区切り(`/`)で 4 つ以上あれば、最後の 2 つだけ残し、前を `…` にする(`A/B/C/D.jpg` → `…/C/D.jpg`)。
 * 先頭に `/` が付くものは、そのまま扱う。
 */
export const shortenPath = (path: string): string => {
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.length <= 3) return parts.join('/');
  return `…/${parts.slice(-2).join('/')}`;
};

/** UTC の ISO 8601 を、この PC の時刻で、`10-10 21:40`(月日と、分まで)にする。表のように、狭いところ用 */
export const formatShortDateTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
