import type { Database } from 'bun:sqlite';
import type { AlbumFilter } from '@file-seiri/ledger';
import type { Context } from 'hono';
import { parseAreaRefs, withAreas } from './areas.ts';
import { parseAlbumFilter } from './query.ts';

/**
 * リクエストの、絞り込みと検索の条件(アルバムの、どの API でも同じ)。
 * 地域(`area`)は、台帳にある場所の格子に直して、場所の条件に足す。
 */
export const albumFilterOf = (db: Database, context: Context): AlbumFilter =>
  withAreas(
    db,
    parseAlbumFilter((name) => context.req.queries(name)),
    parseAreaRefs(context.req.queries('area'))
  );
