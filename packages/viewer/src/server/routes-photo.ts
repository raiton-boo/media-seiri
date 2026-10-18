import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { cityLabel, nearestCity } from '@file-seiri/core';
import { getPhotoDetail, getPhotoStrip } from '@file-seiri/ledger';
import type { Context, Hono } from 'hono';
import type { PhotoDetailResponse, PhotoStripResponse } from '../api-types.ts';
import { albumFilterOf } from './filter.ts';
import { parseId } from './query.ts';
import type { ViewerSource } from './source.ts';

/** ブラウザが、そのまま表示できる形(拡張子 → 種類と、Content-Type)。HEIC・RAW などは、入れない(サムネイルを見せる) */
const DISPLAYABLE: Record<string, { kind: 'image' | 'video'; type: string }> = {
  '.jpg': { kind: 'image', type: 'image/jpeg' },
  '.jpeg': { kind: 'image', type: 'image/jpeg' },
  '.png': { kind: 'image', type: 'image/png' },
  '.gif': { kind: 'image', type: 'image/gif' },
  '.webp': { kind: 'image', type: 'image/webp' },
  '.avif': { kind: 'image', type: 'image/avif' },
  '.bmp': { kind: 'image', type: 'image/bmp' },
  '.mp4': { kind: 'video', type: 'video/mp4' },
  '.m4v': { kind: 'video', type: 'video/mp4' },
  '.mov': { kind: 'video', type: 'video/quicktime' },
  '.webm': { kind: 'video', type: 'video/webm' },
};

/** 前後に出す、片側の枚数の上限 */
const MAX_RADIUS = 30;
const DEFAULT_RADIUS = 8;

/**
 * 台帳にあるファイルの、原本の場所。ライブラリの根の外には、出さない(台帳の値が壊れていても、外を読ませない)。
 * 読めなければ undefined。
 */
const originalPath = (
  source: ViewerSource,
  relPath: string
): string | undefined => {
  const root = resolve(source.libraryRoot);
  const path = resolve(join(root, relPath));
  if (!path.startsWith(root + sep)) return undefined;
  try {
    return existsSync(path) && statSync(path).isFile() ? path : undefined;
  } catch {
    // 接続が切れた・権限がないなどは、「読めない」として扱う
    return undefined;
  }
};

/** `Range: bytes=a-b` を読む。読めなければ undefined(全体を返す)。範囲外なら null */
const parseRange = (
  header: string | undefined,
  size: number
): { start: number; end: number } | undefined | null => {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return undefined;
  const [, from, to] = match;
  if (from === '' && to === '') return undefined;
  const start = from === '' ? Math.max(size - Number(to), 0) : Number(from);
  const end =
    from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start > end || start >= size ? null : { start, end };
};

/**
 * 拡大表示の API(読み取り専用)。
 * - `GET /api/album/photo/:id`: 写真の情報
 * - `GET /api/album/photo/:id/strip`: 前後の写真(絞り込みの条件・`event`・`order`・`radius`)
 * - `GET /api/files/:id`: 原本(台帳にあるファイルだけ。ブラウザで表示できる形だけ。動画は範囲指定に答える)
 */
export const registerPhotoRoutes = (app: Hono, source: ViewerSource): void => {
  const { db } = source.ledger;
  const filterOf = (context: Context) => albumFilterOf(db, context);

  app.get('/api/album/photo/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const photo = id === undefined ? undefined : getPhotoDetail(db, id);
    if (!photo) return context.json({ error: 'not found' }, 404);
    const displayable = DISPLAYABLE[extname(photo.relPath).toLowerCase()];
    const city = photo.gps
      ? nearestCity(photo.gps.lat, photo.gps.lon)
      : undefined;
    const body: PhotoDetailResponse = {
      photo,
      place: city ? { label: cityLabel(city), ref: `city:${city.id}` } : null,
      original: {
        viewKind: displayable?.kind ?? null,
        available: originalPath(source, photo.relPath) !== undefined,
      },
    };
    return context.json(body);
  });

  app.get('/api/album/photo/:id/strip', (context) => {
    const id = parseId(context.req.param('id'));
    if (id === undefined) return context.json({ error: 'bad id' }, 400);
    const order = context.req.query('order') === 'old' ? 'old' : 'new';
    const radius = Math.min(
      parseId(context.req.query('radius')) ?? DEFAULT_RADIUS,
      MAX_RADIUS
    );
    const body: PhotoStripResponse = {
      order,
      ...getPhotoStrip(db, id, filterOf(context), order, radius),
    };
    return context.json(body);
  });

  app.get('/api/files/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const photo = id === undefined ? undefined : getPhotoDetail(db, id);
    if (!photo) return context.notFound();
    const displayable = DISPLAYABLE[extname(photo.relPath).toLowerCase()];
    if (!displayable) return context.json({ error: 'unsupported type' }, 415);
    const path = originalPath(source, photo.relPath);
    if (!path) return context.json({ error: 'original unavailable' }, 404);
    const file = Bun.file(path);
    const size = file.size;
    const headers = {
      'content-type': displayable.type,
      'accept-ranges': 'bytes',
      // 原本は、書き換えられうる(別の実行で直したときなど)。毎回、確かめさせる
      'cache-control': 'no-cache',
    };
    const range = parseRange(context.req.header('range'), size);
    if (range === null) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${size}` },
      });
    }
    if (range === undefined) {
      return new Response(file, {
        headers: { ...headers, 'content-length': String(size) },
      });
    }
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
        'content-length': String(range.end - range.start + 1),
      },
    });
  });
};
