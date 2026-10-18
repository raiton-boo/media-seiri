/// <reference path="./cities.d.ts" />
import cityData from './cities.tsv' with { type: 'text' };

/**
 * 地名(市区町村・都道府県・国)。写真の GPS から、近い地名を求めるための、同梱のデータ(通信しない)。
 * データは GeoNames(https://www.geonames.org/、CC BY 4.0)。作り方は、`scripts/build-geo.ts`。
 */
export type City = {
  id: number;
  /** 日本語名(なければ空) */
  ja: string;
  /** 英語名(ASCII) */
  en: string;
  lat: number;
  lon: number;
  /** 国コード(ISO 3166-1 alpha-2) */
  cc: string;
  /** 地方コード(日本は、都道府県) */
  admin1: string;
  population: number;
};

/** 地域の指定: `city:<ID>`・`pref:<地方コード>`(日本の都道府県)・`country:<国コード>` */
export type AreaRef = string;

/** 日本の都道府県(GeoNames の地方コード → 名前) */
const PREFECTURES: Record<string, string> = {
  '01': '愛知県',
  '02': '秋田県',
  '03': '青森県',
  '04': '千葉県',
  '05': '愛媛県',
  '06': '福井県',
  '07': '福岡県',
  '08': '福島県',
  '09': '岐阜県',
  '10': '群馬県',
  '11': '広島県',
  '12': '北海道',
  '13': '兵庫県',
  '14': '茨城県',
  '15': '石川県',
  '16': '岩手県',
  '17': '香川県',
  '18': '鹿児島県',
  '19': '神奈川県',
  '20': '高知県',
  '21': '熊本県',
  '22': '京都府',
  '23': '三重県',
  '24': '宮城県',
  '25': '宮崎県',
  '26': '長野県',
  '27': '長崎県',
  '28': '奈良県',
  '29': '新潟県',
  '30': '大分県',
  '31': '岡山県',
  '32': '大阪府',
  '33': '佐賀県',
  '34': '埼玉県',
  '35': '滋賀県',
  '36': '島根県',
  '37': '静岡県',
  '38': '栃木県',
  '39': '徳島県',
  '40': '東京都',
  '41': '鳥取県',
  '42': '富山県',
  '43': '和歌山県',
  '44': '山形県',
  '45': '山口県',
  '46': '山梨県',
  '47': '沖縄県',
};

/** 地名とみなす、いちばん遠い距離(km)。これより遠い写真は、地名を付けない(海の上・山奥など) */
export const MAX_PLACE_KM = 80;

type Index = {
  cities: City[];
  byId: Map<number, City>;
  /** 緯度・経度を 1 度ごとに区切った格子 → その中の地名 */
  grid: Map<number, City[]>;
  countries: string[];
};

const cellKey = (latCell: number, lonCell: number): number =>
  (latCell + 90) * 1000 + (((lonCell % 360) + 540) % 360);

let cached: Index | undefined;

const index = (): Index => {
  if (cached) return cached;
  const cities: City[] = [];
  for (const line of cityData.split('\n')) {
    if (line === '') continue;
    const [id, ja, en, lat, lon, cc, admin1, population] = line.split('\t');
    cities.push({
      id: Number(id),
      ja: ja ?? '',
      en: en ?? '',
      lat: Number(lat),
      lon: Number(lon),
      cc: cc ?? '',
      admin1: admin1 ?? '',
      population: Number(population),
    });
  }
  const grid = new Map<number, City[]>();
  for (const city of cities) {
    const key = cellKey(Math.floor(city.lat), Math.floor(city.lon));
    const bucket = grid.get(key);
    if (bucket) bucket.push(city);
    else grid.set(key, [city]);
  }
  cached = {
    cities,
    byId: new Map(cities.map((city) => [city.id, city])),
    grid,
    countries: [...new Set(cities.map((city) => city.cc))],
  };
  return cached;
};

const EARTH_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 2 点の距離(km。大円距離) */
export const distanceBetweenKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** 近さを探す、格子の枠(周囲 2 マス。緯度 1 度は約 111km なので、約 200km の範囲) */
const SEARCH_RINGS = 2;

/** 日本で、いちばん近い地名のかわりに、市・区・町・村の名前を選ぶ幅(km)。駅や町丁の小さな地名ではなく、市区町村で見せる */
const JAPAN_MUNICIPALITY_MARGIN_KM = 3;
/** 日本以外で、いちばん近い地名のかわりに、人口の多い地名を選ぶ幅(km)。「Paris 16 Passy」ではなく「パリ」で見せる */
const WORLD_POPULATION_MARGIN_KM = 6;

const MUNICIPALITY_SUFFIX = /[市区町村]$/;

/**
 * 座標に合う地名(`MAX_PLACE_KM` より遠ければ、なし)。いちばん近い地名を基に、見せ方を整える:
 * 日本は、近い範囲の市区町村(浅草の近くなら「浅草区」)、日本以外は、近い範囲で人口の多い地名(「パリ」)。
 */
export const nearestCity = (lat: number, lon: number): City | undefined => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const { grid } = index();
  const latCell = Math.floor(lat);
  const lonCell = Math.floor(lon);
  const near: { city: City; km: number }[] = [];
  for (let dLat = -SEARCH_RINGS; dLat <= SEARCH_RINGS; dLat += 1) {
    for (let dLon = -SEARCH_RINGS; dLon <= SEARCH_RINGS; dLon += 1) {
      for (const city of grid.get(cellKey(latCell + dLat, lonCell + dLon)) ??
        []) {
        const km = distanceBetweenKm(lat, lon, city.lat, city.lon);
        if (km <= MAX_PLACE_KM) near.push({ city, km });
      }
    }
  }
  if (near.length === 0) return undefined;
  near.sort((a, b) => a.km - b.km);
  const first = near[0] as { city: City; km: number };
  if (first.city.cc === 'JP') {
    const municipal = near.find(
      (item) =>
        item.km <= first.km + JAPAN_MUNICIPALITY_MARGIN_KM &&
        item.city.cc === 'JP' &&
        MUNICIPALITY_SUFFIX.test(item.city.ja)
    );
    return (municipal ?? first).city;
  }
  return near
    .filter((item) => item.km <= first.km + WORLD_POPULATION_MARGIN_KM)
    .sort((a, b) => b.city.population - a.city.population)[0]?.city;
};

export const getCity = (id: number): City | undefined => index().byId.get(id);

const regionNames = {
  ja: new Intl.DisplayNames(['ja'], { type: 'region' }),
  en: new Intl.DisplayNames(['en'], { type: 'region' }),
};

/** 国の名前(日本語)。分からなければ、国コード */
export const countryName = (cc: string): string => {
  try {
    return regionNames.ja.of(cc) ?? cc;
  } catch {
    return cc;
  }
};

/** 都道府県の名前(日本)。ないものは、undefined */
export const prefectureName = (admin1: string): string | undefined =>
  PREFECTURES[admin1];

/** 地名の表示: `台東区(東京都)`・`パリ(フランス)`。日本語名がなければ、英語名 */
export const cityLabel = (city: City): string => {
  const name = city.ja || city.en;
  const parent =
    city.cc === 'JP' ? prefectureName(city.admin1) : countryName(city.cc);
  return parent && parent !== name ? `${name}(${parent})` : name;
};

/** この地名を含む地域の指定(地名・都道府県(日本)・国) */
export const areaRefsOf = (city: City): AreaRef[] => [
  `city:${city.id}`,
  ...(city.cc === 'JP' && PREFECTURES[city.admin1]
    ? [`pref:${city.admin1}`]
    : []),
  `country:${city.cc}`,
];

/** 地域の指定の表示。知らない指定は、undefined */
export const areaLabel = (ref: AreaRef): string | undefined => {
  const [kind, value = ''] = ref.split(':');
  if (kind === 'city') {
    const city = getCity(Number(value));
    return city ? cityLabel(city) : undefined;
  }
  if (kind === 'pref') return PREFECTURES[value];
  if (kind === 'country')
    return value.length === 2 ? countryName(value) : undefined;
  return undefined;
};

/** 座標の、地名の説明(`台東区(東京都) 付近`)。近い地名がなければ、undefined */
export const describeNearest = (
  lat: number,
  lon: number
): string | undefined => {
  const city = nearestCity(lat, lon);
  return city ? `${cityLabel(city)} 付近` : undefined;
};

const normalize = (text: string): string =>
  text.normalize('NFKC').trim().toLowerCase();

/** 見つけ方の強さ: 完全一致 0、前方一致 1、含む 2、合わない undefined */
const matchScore = (name: string, query: string): number | undefined => {
  if (name === '') return undefined;
  const text = normalize(name);
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  return text.includes(query) ? 2 : undefined;
};

/** 地域の種類の順(同じ強さなら、広い地域から) */
const KIND_RANK: Record<string, number> = { country: 0, pref: 1, city: 2 };

/**
 * 入力から、地域(国・都道府県・地名)を探す。日本語名・英語名の、完全一致・前方一致・含む、の順。
 * 同じ強さなら、広い地域が先、地名は人口の多い順。英数字だけの入力は、2 文字以上から。
 */
export const searchAreas = (text: string, limit = 8): AreaRef[] => {
  const query = normalize(text);
  // 英数字だけの入力は、2 文字から(1 文字では、多すぎて、意味がない)
  if (query === '' || (/^\p{ASCII}+$/u.test(query) && query.length < 2))
    return [];
  const { cities, countries } = index();
  const found: {
    ref: AreaRef;
    score: number;
    rank: number;
    population: number;
  }[] = [];
  const consider = (
    ref: AreaRef,
    names: string[],
    rank: number,
    population: number
  ): void => {
    const scores = names
      .map((name) => matchScore(name, query))
      .filter((score): score is number => score !== undefined);
    if (scores.length > 0)
      found.push({ ref, score: Math.min(...scores), rank, population });
  };
  for (const cc of countries) {
    let english = cc;
    try {
      english = regionNames.en.of(cc) ?? cc;
    } catch {
      // 知らない国コードは、コードのまま
    }
    consider(
      `country:${cc}`,
      [countryName(cc), english],
      KIND_RANK.country ?? 0,
      0
    );
  }
  for (const [code, name] of Object.entries(PREFECTURES)) {
    consider(
      `pref:${code}`,
      [name, name.replace(/[都道府県]$/, '')],
      KIND_RANK.pref ?? 1,
      0
    );
  }
  for (const city of cities) {
    consider(
      `city:${city.id}`,
      [city.ja, city.en],
      KIND_RANK.city ?? 2,
      city.population
    );
  }
  return found
    .sort(
      (a, b) =>
        a.score - b.score || a.rank - b.rank || b.population - a.population
    )
    .slice(0, limit)
    .map((item) => item.ref);
};

/** 範囲(南・西・北・東の度) */
export type GeoBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** 地名ひとつの周りの範囲(地図を、その地名へ動かすときの広さ。約 ±5km) */
const CITY_RADIUS_DEGREES = 0.05;

/**
 * 地域の指定の、地図上の範囲。地名は、その周り。都道府県・国は、含まれる地名(同梱のデータ)を囲む範囲。
 * 知らない指定・地名のない地域は、undefined。
 */
export const areaBounds = (ref: AreaRef): GeoBounds | undefined => {
  const [kind, value = ''] = ref.split(':');
  if (kind === 'city') {
    const city = getCity(Number(value));
    return city
      ? {
          south: city.lat - CITY_RADIUS_DEGREES,
          north: city.lat + CITY_RADIUS_DEGREES,
          west: city.lon - CITY_RADIUS_DEGREES,
          east: city.lon + CITY_RADIUS_DEGREES,
        }
      : undefined;
  }
  if (kind !== 'pref' && kind !== 'country') return undefined;
  const members = index().cities.filter((city) =>
    kind === 'pref'
      ? city.cc === 'JP' && city.admin1 === value
      : city.cc === value
  );
  if (members.length === 0) return undefined;
  return {
    south: Math.min(...members.map((city) => city.lat)),
    north: Math.max(...members.map((city) => city.lat)),
    west: Math.min(...members.map((city) => city.lon)),
    east: Math.max(...members.map((city) => city.lon)),
  };
};

/** 地域の指定の、中心の座標(地名は、その位置。都道府県・国は、範囲の中心) */
export const areaCenter = (
  ref: AreaRef
): { lat: number; lon: number } | undefined => {
  const bounds = areaBounds(ref);
  return bounds
    ? {
        lat: (bounds.south + bounds.north) / 2,
        lon: (bounds.west + bounds.east) / 2,
      }
    : undefined;
};
