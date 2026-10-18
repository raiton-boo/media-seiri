/** スライドショーの、決まり(順序・速度・シャッフル) */

/** 速度(秒)の選択肢 */
export const SPEEDS = [2, 3, 5, 8, 10] as const;
export const DEFAULT_SPEED = 3;

/** URL の速度を読む。選択肢にないものは、既定 */
export const parseSpeed = (value: string | undefined): number => {
  const number = Number(value);
  return (SPEEDS as readonly number[]).includes(number)
    ? number
    : DEFAULT_SPEED;
};

/** 次の速度(選択肢を、順にめぐる) */
export const nextSpeed = (speed: number): number => {
  const index = (SPEEDS as readonly number[]).indexOf(speed);
  return SPEEDS[(index + 1) % SPEEDS.length] ?? DEFAULT_SPEED;
};

/** 種から決まる乱数(mulberry32)。同じ種なら、同じ並びになる(再描画で、並びが変わらないように) */
const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

/** 並びを、種から決まる順にシャッフルする(元の配列は、変えない) */
export const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const next = random(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other] as T, result[index] as T];
  }
  return result;
};

/** 進み具合(0〜1)。経過した時間と、1 枚の長さから */
export const progressOf = (elapsedMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : Math.min(Math.max(elapsedMs / durationMs, 0), 1);
