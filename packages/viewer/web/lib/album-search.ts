/**
 * 検索の札の表示(URL の値から)。サーバー(ledger の `describeDate`・`describePlace`)と、同じ書き方にする。
 * ledger は `bun:sqlite` を使うので、画面からは、取り込めない。
 */
export const describeDate = (value: string): string => {
  const [year, month, day] = value.split('-');
  return `${year}年${month ? `${Number(month)}月` : ''}${day ? `${Number(day)}日` : ''}`;
};

/** 場所(`緯度:経度`)を、座標の近くとして、表す。地名には、しない */
export const describePlace = (value: string): string => {
  const [lat = 0, lon = 0] = value.split(':').map(Number);
  return `${lat >= 0 ? '北緯' : '南緯'}${Math.abs(lat).toFixed(1)}° ${lon >= 0 ? '東経' : '西経'}${Math.abs(lon).toFixed(1)}° 付近`;
};

/** 場所の格子を、URL の値にする */
export const placeValue = (place: { lat: number; lon: number }): string =>
  `${place.lat}:${place.lon}`;
