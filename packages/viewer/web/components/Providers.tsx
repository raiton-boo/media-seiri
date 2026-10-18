'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { LiveProvider } from '../lib/live';

export function Providers({ children }: { children: ReactNode }) {
  // 台帳は、読み取り専用で、めったに変わらない。画面を切り替えるたびに、読み直さない
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <LiveProvider>{children}</LiveProvider>
    </QueryClientProvider>
  );
}
