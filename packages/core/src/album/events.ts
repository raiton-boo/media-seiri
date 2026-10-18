/** できごとの計算に渡す、ライブラリのファイル(精度 `full` / `date` のもの) */
export type EventFile = {
  id: number;
  /** `formatTakenAt` の形式: `YYYY-MM-DDTHH:mm:ss`(精度 `full`)または `YYYY-MM-DD`(精度 `date`) */
  takenAt: string;
  precision: 'full' | 'date';
  /** GPS(なければ、両方とも省く) */
  lat?: number;
  lon?: number;
};

/** できごとを区切る規則(既定は、仕様書 §16-6 の値。設定で変えられる) */
export type EventOptions = {
  /** この時間以上あいたら、新しいできごと(時間) */
  gapHours: number;
  /** この距離以上で、かつ `distanceGapHours` 以上あいたら、新しいできごと(km。GPS が、両方にある場合のみ) */
  distanceKm: number;
  distanceGapHours: number;
};

export const DEFAULT_EVENT_OPTIONS: EventOptions = {
  gapHours: 4,
  distanceKm: 5,
  distanceGapHours: 1,
};

/** 計算したできごと */
export type ComputedEvent = {
  /** 属するファイルの ID(撮影日時の順) */
  fileIds: number[];
  /** 最初・最後のファイルの `takenAt`(精度 `date` のできごとは、日付だけ) */
  startAt: string;
  endAt: string;
  /** GPS のあるファイルの、位置の平均。1 枚もなければ null */
  centroid: { lat: number; lon: number } | null;
  /** 代表の写真: GPS つきを優先し、なければ、先頭(仮。仕様書 §16-6) */
  coverId: number;
  /** 区切った規則(`4h/5km` など) */
  rule: string;
};

const HOUR_MS = 3_600_000;
const EARTH_RADIUS_KM = 6371;

/** `takenAt` を、ミリ秒にする(時刻のない日付は、その日の 0 時)。地域の時刻のまま、差だけを取るため、UTC として読む */
const toMs = (takenAt: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(
    takenAt
  );
  if (!match)
    throw new RangeError(`撮影日時の形式が正しくありません: ${takenAt}`);
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
};

/** 2 点の距離(km。大円距離) */
export const distanceKm = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number => {
  const rad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

type Timed = EventFile & { ms: number };

const hasGps = <T extends EventFile>(
  file: T
): file is T & { lat: number; lon: number } =>
  file.lat !== undefined && file.lon !== undefined;

const summarize = (members: Timed[], rule: string): ComputedEvent => {
  const first = members[0] as Timed;
  const last = members[members.length - 1] as Timed;
  const withGps = members.filter(hasGps);
  const centroid =
    withGps.length === 0
      ? null
      : {
          lat:
            withGps.reduce((sum, file) => sum + file.lat, 0) / withGps.length,
          lon:
            withGps.reduce((sum, file) => sum + file.lon, 0) / withGps.length,
        };
  return {
    fileIds: members.map((file) => file.id),
    startAt: first.takenAt,
    endAt: last.takenAt,
    centroid,
    coverId: (withGps[0] ?? first).id,
    rule,
  };
};

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

/**
 * できごとを計算する(仕様書 §16-6)。純粋な計算で、入力の並びに、よらない。
 * - 精度 `full` のファイルを、撮影日時の順に並べ、隣り合う 2 枚が、次のいずれかなら、新しいできごとを始める。
 *   時間差が `gapHours` 以上 / 距離が `distanceKm` 以上で、かつ時間差が `distanceGapHours` 以上(GPS が、両方にある場合のみ)
 * - 精度 `date`(時刻なし)のファイルは、日単位で、1 つのできごとにまとめる。
 * できごとは、開始の順に返す。同じ開始なら、ファイルの ID の小さいほうが先。
 */
export const computeAlbumEvents = (
  files: readonly EventFile[],
  options: EventOptions = DEFAULT_EVENT_OPTIONS
): ComputedEvent[] => {
  const rule = `${formatNumber(options.gapHours)}h/${formatNumber(options.distanceKm)}km`;
  const timed: Timed[] = files.map((file) => ({
    ...file,
    ms: toMs(file.takenAt),
  }));
  const byTime = (a: Timed, b: Timed): number => a.ms - b.ms || a.id - b.id;

  const events: ComputedEvent[] = [];

  const full = timed.filter((file) => file.precision === 'full').sort(byTime);
  let current: Timed[] = [];
  for (const file of full) {
    const previous = current[current.length - 1];
    if (previous && startsNewEvent(previous, file, options)) {
      events.push(summarize(current, rule));
      current = [];
    }
    current.push(file);
  }
  if (current.length > 0) events.push(summarize(current, rule));

  const byDay = new Map<string, Timed[]>();
  for (const file of timed.filter(
    (candidate) => candidate.precision === 'date'
  )) {
    const day = file.takenAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), file]);
  }
  for (const members of byDay.values()) {
    events.push(summarize(members.sort(byTime), 'day'));
  }

  return events.sort(
    (a, b) =>
      toMs(a.startAt) - toMs(b.startAt) ||
      (a.fileIds[0] as number) - (b.fileIds[0] as number)
  );
};

const startsNewEvent = (
  previous: Timed,
  next: Timed,
  options: EventOptions
): boolean => {
  const gap = next.ms - previous.ms;
  if (gap >= options.gapHours * HOUR_MS) return true;
  if (
    hasGps(previous) &&
    hasGps(next) &&
    gap >= options.distanceGapHours * HOUR_MS
  ) {
    return distanceKm(previous, next) >= options.distanceKm;
  }
  return false;
};
