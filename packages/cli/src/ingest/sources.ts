import { relative, resolve, sep } from 'node:path';

const isInside = (child: string, parent: string): boolean => {
  const path = relative(parent, child);
  return (
    path === '' ||
    (!path.startsWith('..') && !path.startsWith(sep) && path !== '..')
  );
};

/**
 * 取り込み元の重なりを、外す。ほかの取り込み元の中にある取り込み元(と、同じ場所の重複)は、
 * 同じファイルを 2 度読むだけなので、外側のものだけにする(順番は、保つ)。
 */
export const dropOverlappingSources = (
  sources: readonly string[]
): { kept: string[]; dropped: { source: string; parent: string }[] } => {
  const resolved = sources.map((source) => resolve(source));
  const kept: string[] = [];
  const dropped: { source: string; parent: string }[] = [];
  for (const [index, source] of sources.entries()) {
    const path = resolved[index] ?? source;
    const parentIndex = resolved.findIndex((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (!isInside(path, other)) return false;
      // 同じ場所は、先に出てきたほうを残す
      return path !== other || otherIndex < index;
    });
    if (parentIndex >= 0) {
      dropped.push({ source, parent: sources[parentIndex] ?? source });
    } else {
      kept.push(source);
    }
  }
  return { kept, dropped };
};
