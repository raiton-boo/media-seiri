import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { createViewerApp } from './app.ts';
import { guardRequest } from './guard.ts';
import type { ViewerSource } from './source.ts';
import { staticFiles } from './static.ts';

/** 画面の静的ファイル(Next.js の書き出し)の、ふつうの場所。`bun run --filter @file-seiri/viewer build:web` で作る */
export const DEFAULT_WEB_DIR = resolve(import.meta.dir, '../../web/out');

/** 外部に公開しないため、本機からの接続だけを受け付ける */
export const VIEWER_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3939;

export type RunningViewer = {
  url: string;
  stop: () => void;
};

/** API と画面(`webDir`)を、本機(127.0.0.1)だけで配信する */
export const startViewer = (options: {
  source: ViewerSource;
  /** 画面の静的ファイル(`packages/viewer/web/out`) */
  webDir: string;
  /** 0 なら、空いているポートを選ぶ */
  port: number;
}): RunningViewer => {
  const api: Hono = createViewerApp(options.source);
  const files = staticFiles(options.webDir);
  const server = Bun.serve({
    hostname: VIEWER_HOST,
    port: options.port,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/api/')) return api.fetch(request);
      // 画面のファイルにも、同じ制限(本機だけ・閲覧専用)をかける
      const refused = guardRequest(request);
      if (refused) return refused;
      return files(pathname) ?? new Response('見つかりません', { status: 404 });
    },
  });
  return {
    url: `http://${VIEWER_HOST}:${server.port}/`,
    stop: () => void server.stop(true),
  };
};
