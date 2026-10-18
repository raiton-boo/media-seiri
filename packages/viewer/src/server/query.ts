/** クエリ文字列の読み取り。不正な値は、既定値にする(エラーにはしない。画面の URL を手で書き換えても、壊れないように) */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

const toInt = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number(value);
};

export const parsePage = (query: {
  limit?: string;
  offset?: string;
}): { limit: number; offset: number } => {
  const limit = toInt(query.limit);
  return {
    limit:
      limit === undefined || limit < 1
        ? DEFAULT_LIMIT
        : Math.min(limit, MAX_LIMIT),
    offset: toInt(query.offset) ?? 0,
  };
};

export const parseId = (value: string | undefined): number | undefined =>
  toInt(value);
