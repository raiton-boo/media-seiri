/** 打ち間違いに、近い名前を提案する(「もしかして」) */

/** 2 つの文字列の、編集距離(1 文字の追加・削除・置き換えを、1 と数える) */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

/** いちばん近い候補を、最大 `limit` 個。近すぎない(長さの 1/3 まで、または、前方一致)ものだけ */
export const suggest = (
  typed: string,
  candidates: readonly string[],
  limit = 2
): string[] => {
  const word = typed.toLowerCase();
  if (word.length === 0) return [];
  return candidates
    .map((candidate) => {
      const name = candidate.toLowerCase();
      const near = distance(word, name);
      const prefix = word.length >= 2 && name.startsWith(word);
      return {
        candidate,
        score: prefix ? 0 : near,
        ok: prefix || near <= Math.max(1, Math.floor(name.length / 3)),
      };
    })
    .filter((item) => item.ok)
    .sort((x, y) => x.score - y.score)
    .slice(0, limit)
    .map((item) => item.candidate);
};

/** 「もしかして」の 1 行(候補がなければ、空) */
export const didYouMean = (
  typed: string,
  candidates: readonly string[]
): string => {
  const found = suggest(typed, candidates);
  return found.length > 0 ? `もしかして: ${found.join(' / ')}\n` : '';
};
