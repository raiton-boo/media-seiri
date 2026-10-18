'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * 画面の状態(絞り込み・ページ・選択)を、URL のクエリ文字列に持つ(`tech-selection.md` §3-1: 可変の URL は、クエリ文字列で表す)。
 * 値が空(undefined)なら、そのキーは消す。履歴は、積まずに置き換える。
 */
export const useUrlState = () => {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (key: string): string | undefined => params.get(key) ?? undefined;
  const set = useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    },
    [params, router, pathname]
  );
  return { get, set };
};
