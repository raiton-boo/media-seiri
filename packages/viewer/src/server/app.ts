import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDashboardSummary,
  getRunningProgress,
  listRunSummaries,
} from '@file-seiri/ledger';
import { Hono } from 'hono';
import type { DashboardResponse, ViewerInfo } from '../api-types.ts';
import { guardRequest } from './guard.ts';
import { registerAlbumRoutes } from './routes-album.ts';
import { registerDupeRoutes } from './routes-dupes.ts';
import { registerErrorRoutes } from './routes-errors.ts';
import { registerFallbackRoutes } from './routes-fallback.ts';
import { registerMapRoutes } from './routes-map.ts';
import { registerPhotoRoutes } from './routes-photo.ts';
import { registerRunRoutes } from './routes-runs.ts';
import type { ViewerSource } from './source.ts';

/** ダッシュボードに出す、最近の実行の数 */
const RECENT_RUNS = 5;

const THUMB_DIRECTORY = /^[0-9a-f]{2}$/;
const THUMB_FILE = /^[0-9a-f]{64}\.jpg$/;

/**
 * ビューアの API(読み取り専用。GET だけ)。画面の静的ファイルは、別(`serveStatic`)。
 * - `GET /api/info`: ライブラリ・台帳の鮮度(上のナビのチップ)
 * - `GET /api/dashboard`: ダッシュボード
 * - `GET /api/thumbs/<2 文字>/<ハッシュ>.jpg`: サムネイル
 * - `GET /api/map/config`・`/api/map/clusters`: 地図(背景地図の設定・表示範囲のまとまり)
 * - `GET /api/files/<ID>`: 原本(拡大表示。ライブラリが接続中のときだけ)
 * - `GET /api/errors`・`/api/errors/:id`・`/api/errors.csv`: エラー一覧(コード・実行で絞り込み)
 * - `GET /api/runs`・`/api/runs/:id`: 実行履歴
 * - `GET /api/fallback`: 日付フォールバック一覧
 * - `GET /api/dupes`・`/api/dupes/:id`: 重複比較
 * - `GET /api/album/*`: アルバム(overview・year・month・event・memories)
 */
export const createViewerApp = (source: ViewerSource): Hono => {
  const app = new Hono();

  app.use('*', async (context, next) => {
    const refused = guardRequest(context.req.raw);
    if (refused) return refused;
    await next();
  });

  const info = (): ViewerInfo => ({
    library: source.library,
    source: source.source,
    asOf: source.asOf().toISOString(),
    // 外れているときは、台帳の置き場の確認が失敗するだけなので、存在で見る
    libraryConnected: existsSync(source.libraryRoot),
  });

  app.get('/api/info', (context) => context.json(info()));

  app.get('/api/dashboard', (context) => {
    const { db } = source.ledger;
    const body: DashboardResponse = {
      ...info(),
      summary: getDashboardSummary(db),
      runs: listRunSummaries(db, RECENT_RUNS),
      // 実行中の表示は、この Mac の作業用の台帳だけ(スナップショットは、実行を終えたあとに保存するため)
      running:
        source.source === 'working' ? (getRunningProgress(db) ?? null) : null,
      disk: source.disk(),
    };
    return context.json(body);
  });

  app.get('/api/thumbs/:directory/:file', (context) => {
    const { directory, file } = context.req.param();
    // 名前の形を限る(`..` などで、サムネイルの置き場の外を読ませない)
    if (!THUMB_DIRECTORY.test(directory) || !THUMB_FILE.test(file)) {
      return context.notFound();
    }
    const path = join(source.thumbsDir, directory, file);
    if (!existsSync(path) || !statSync(path).isFile())
      return context.notFound();
    // 名前が内容のハッシュなので、中身は変わらない(長く覚えてよい)
    return new Response(Bun.file(path), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  registerErrorRoutes(app, source);
  registerRunRoutes(app, source);
  registerFallbackRoutes(app, source);
  registerDupeRoutes(app, source);
  registerAlbumRoutes(app, source);
  registerPhotoRoutes(app, source);
  registerMapRoutes(app, source);

  app.all('/api/*', (context) => context.json({ error: 'not found' }, 404));
  return app;
};
