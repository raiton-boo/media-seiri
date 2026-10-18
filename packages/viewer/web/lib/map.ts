/** 地図の、決まり(まとまりの大きさ・色・範囲の文字) */

/** 範囲(`南,西,北,東`。URL・API の形) */
export type Bounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** 範囲の文字の、小数点以下の桁数(5 桁 = 約 1m) */
const COORDINATE_DIGITS = 5;

/**
 * 範囲を、URL・API の文字にする(小数点以下 5 桁 = 約 1m)。
 * 地図は、縮小すると、地球の外(経度 ±180 度・緯度 ±90 度の外)まで映るため、地球の中に収める(外だと、API が範囲を読めず、絞り込まれない)。
 */
export const boundsToString = (bounds: Bounds): string => {
  const clamp = (value: number, limit: number): number =>
    Math.min(Math.max(value, -limit), limit);
  // 範囲は、広がる向きに丸める(南・西は切り捨て、北・東は切り上げ)。四捨五入だと、境界の上の写真が、範囲の外になる
  // (1 点のまとまりの範囲が、その写真自身を、含まなくなっていた)
  const scale = 10 ** COORDINATE_DIGITS;
  const down = (value: number): number => Math.floor(value * scale) / scale;
  const up = (value: number): number => Math.ceil(value * scale) / scale;
  return [
    down(clamp(bounds.south, 90)),
    down(clamp(bounds.west, 180)),
    up(clamp(bounds.north, 90)),
    up(clamp(bounds.east, 180)),
  ]
    .map((value) => Number(value.toFixed(COORDINATE_DIGITS)))
    .join(',');
};

/** 範囲の文字を読む。読めなければ undefined */
export const parseBounds = (value: string | undefined): Bounds | undefined => {
  const parts = (value ?? '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)))
    return undefined;
  const [south, west, north, east] = parts as [number, number, number, number];
  return { south, west, north, east };
};

/** 範囲を、地図の外側に、少し広げる(端のまとまりが、切れないように) */
export const padBounds = (bounds: Bounds, ratio: number): Bounds => {
  const dLat = (bounds.north - bounds.south) * ratio;
  const dLon = (bounds.east - bounds.west) * ratio;
  return {
    south: Math.max(-90, bounds.south - dLat),
    north: Math.min(90, bounds.north + dLat),
    west: Math.max(-180, bounds.west - dLon),
    east: Math.min(180, bounds.east + dLon),
  };
};

/**
 * このくらいの枚数までは、円ではなく、ピンで出す(2 枚以上が重なる場所は、枚数の印つき)。
 * これより多いときは、件数の円。
 */
export const MAX_PIN_COUNT = 4;

/** このズーム以上では、件数が多くても、円ではなく、ピン(件数の印つき)で出す。ここまで近づくと、残るまとまりは、同じ場所の写真だけ */
export const PIN_ZOOM = 16;

/** まとまりを、ピンで出すか(少ない件数、または、十分に近づいたとき) */
export const isPinCluster = (count: number, zoom: number): boolean =>
  count <= MAX_PIN_COUNT || zoom >= PIN_ZOOM;

/** まとまりの印の、大きさ(px)。件数が多いほど大きく(対数で、ゆるやかに) */
export const clusterSize = (count: number): number =>
  Math.round(Math.min(96, 38 + Math.log10(Math.max(count, 1)) * 18));

/** まとまりの印の色の段(件数): 多い=紫、100 以上=黄、10 以上=青、それ以外=緑 */
export const clusterTone = (count: number): 'p' | 'y' | 'b' | 'g' =>
  count >= 1000 ? 'p' : count >= 100 ? 'y' : count >= 10 ? 'b' : 'g';

/** まとまりが、1 点(全部が、同じ位置)か */
export const isSinglePoint = (cluster: {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}): boolean =>
  cluster.minLat === cluster.maxLat && cluster.minLon === cluster.maxLon;
