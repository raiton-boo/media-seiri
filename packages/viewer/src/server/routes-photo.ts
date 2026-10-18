import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { cityLabel, nearestCity } from '@file-seiri/core';
import {
  countFilteredPhotos,
  getPhotoDetail,
  getPhotoStrip,
  listFilteredPhotos,
  listSameDayOtherYears,
  listSourceCopies,
} from '@file-seiri/ledger';
import type { Context, Hono } from 'hono';
import type {
  PhotoDetailResponse,
  PhotoStripResponse,
  SameDayResponse,
  SlideshowResponse,
} from '../api-types.ts';
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

/** スライドショーで、1 回に渡す写真の上限(あまりに多いと、重い。先頭から、これだけ) */
const MAX_SLIDES = 3000;
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

/** 読む原本の場所と、どこのものか */
type ResolvedOriginal = {
  path: string;
  from: 'library' | 'source';
  sourceLabel: string | null;
};

/**
 * 原本を探す(仕様書 §16-7)。ライブラリのファイルが読めればそれ。読めなければ、同じ内容のソース側のコピーが、
 * いま接続中のドライブにあり、サイズと更新日が記録と一致するときだけ、それ。どちらもなければ undefined。
 */
const resolveOriginal = (
  source: ViewerSource,
  libraryFileId: number,
  relPath: string
): ResolvedOriginal | undefined => {
  const inLibrary = originalPath(source, relPath);
  if (inLibrary) return { path: inLibrary, from: 'library', sourceLabel: null };
  const mounted = source.mountedRoots?.();
  if (!mounted || mounted.size === 0) return undefined;
  for (const copy of listSourceCopies(source.ledger.db, libraryFileId)) {
    const root = mounted.get(copy.volumeUuid);
    if (!root) continue;
    const base = resolve(root);
    const path = resolve(join(base, copy.relPath));
    // 台帳の値が壊れていても、ドライブの外は、読ませない
    if (!path.startsWith(base + sep)) continue;
    try {
      const stat = statSync(path);
      if (
        stat.isFile() &&
        stat.size === copy.sizeBytes &&
        Math.floor(stat.mtimeMs) === copy.mtimeMs
      ) {
        return { path, from: 'source', sourceLabel: copy.volumeLabel };
      }
    } catch {
      // 読めない・なくなった: 次の候補へ
    }
  }
  return undefined;
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
 * - `GET /api/album/photo/:id/same-day`: この日の他の年
 * - `GET /api/album/photo/:id/strip`: 前後の写真(絞り込みの条件・`event`・`order`・`radius`)
 * - `GET /api/album/slideshow`: スライドショーの写真(条件・`event`・`order`)
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
    const resolved = resolveOriginal(
      source,
      photo.libraryFileId,
      photo.relPath
    );
    const city = photo.gps
      ? nearestCity(photo.gps.lat, photo.gps.lon)
      : undefined;
    const body: PhotoDetailResponse = {
      photo,
      place: city ? { label: cityLabel(city), ref: `city:${city.id}` } : null,
      original: {
        viewKind: displayable?.kind ?? null,
        available: resolved !== undefined,
        from: resolved?.from ?? null,
        sourceLabel: resolved?.sourceLabel ?? null,
      },
    };
    return context.json(body);
  });

  // 「この日の他の年」
  app.get('/api/album/photo/:id/same-day', (context) => {
    const id = parseId(context.req.param('id'));
    if (id === undefined) return context.json({ error: 'bad id' }, 400);
    const found = listSameDayOtherYears(db, id);
    const body: SameDayResponse = found
      ? { monthDay: found.monthDay, years: found.years }
      : { monthDay: null, years: [] };
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

  // スライドショー: 条件に合う写真を、表示の順に(先頭から `MAX_SLIDES` 枚まで)
  app.get('/api/album/slideshow', (context) => {
    const order = context.req.query('order') === 'old' ? 'old' : 'new';
    const filter = filterOf(context);
    const body: SlideshowResponse = {
      order,
      total: countFilteredPhotos(db, filter),
      photos: listFilteredPhotos(db, filter, order, {
        limit: MAX_SLIDES,
        offset: 0,
      }),
    };
    return context.json(body);
  });

  app.get('/api/files/:id', (context) => {
    const id = parseId(context.req.param('id'));
    const photo = id === undefined ? undefined : getPhotoDetail(db, id);
    if (!photo) return context.notFound();
    const displayable = DISPLAYABLE[extname(photo.relPath).toLowerCase()];
    if (!displayable) return context.json({ error: 'unsupported type' }, 415);
    const resolved = resolveOriginal(
      source,
      photo.libraryFileId,
      photo.relPath
    );
    if (!resolved) return context.json({ error: 'original unavailable' }, 404);
    const file = Bun.file(resolved.path);
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
