'use client';

import type { MapCluster } from '@file-seiri/ledger';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlbumFilterProvider } from '../../lib/album-context';
import { EMPTY_FILTER, type FilterState } from '../../lib/album-filter';
import {
  thumbUrl,
  useAlbumFilters,
  useMapClusters,
  useMapConfig,
  useSearchPhotos,
} from '../../lib/api';
import { formatCount } from '../../lib/format';
import {
  type Bounds,
  boundsToString,
  isSinglePoint,
  MAX_PHOTO_MARKER_COUNT,
  padBounds,
} from '../../lib/map';
import { useAlbumFilterState } from '../../lib/use-album-filter';
import { FilterBar } from '../album/FilterBar';
import { FilterDrawer } from '../album/FilterDrawer';
import { Button } from '../Button';
import { ListSkeleton } from '../ListSkeleton';
import { LoadError } from '../motion/LoadError';
import { RevealPage } from '../motion/Reveal';
import { MapCanvas, type MapView as View } from './MapCanvas';
import { PlaceSearch } from './PlaceSearch';

/** 最初の位置(URL に位置がないとき): 日本の全体。写真の範囲が分かったら、そこへ動かす */
const DEFAULT_VIEW = { lat: 36, lon: 138, zoom: 4.5 };
const WORLD = '-90,-180,90,180';
/** 表示範囲を、少し広げて、まとまりを取る(端の印が、切れないように) */
const VIEW_PADDING = 0.1;
/** これ以上近づいたら、まとまりを押しても、拡大せず、写真を見せる */
const MAX_FIT_ZOOM = 16;
const PANEL_PHOTOS = 9;

const urlView = (get: (key: string) => string | undefined) => {
  const center = (get('c') ?? '').split(',').map(Number);
  const zoom = Number(get('z'));
  const [lat, lon] = center;
  return lat !== undefined &&
    lon !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Number.isFinite(zoom)
    ? { initial: { lat, lon, zoom }, hasView: true }
    : { initial: DEFAULT_VIEW, hasView: false };
};

/** まとまりの範囲(1 点でも、等号の比較で、外れないように、ほんの少し広げる) */
const clusterBounds = (cluster: MapCluster): Bounds => ({
  south: cluster.minLat - 1e-6,
  west: cluster.minLon - 1e-6,
  north: cluster.maxLat + 1e-6,
  east: cluster.maxLon + 1e-6,
});

/** この場所の、写真の札を出す、最大の枚数(それより多いときは、アルバムで) */
const POPUP_PHOTOS = 12;

/**
 * 押した場所の札: その場所の写真を、小さな札(サムネイル)で、まとめて見せる(1 枚でも、複数枚でも)。
 * 同じ場所に、たくさんあるときは、上の枚数まで見せて、残りは、アルバムの「すべて」で。
 */
function PlaceCard({
  cluster,
  filter,
  onClose,
}: {
  cluster: MapCluster;
  filter: FilterState;
  onClose: () => void;
}) {
  const state = useAlbumFilterState();
  const bbox = boundsToString(clusterBounds(cluster));
  const scoped: FilterState = { ...filter, bbox };
  const photos = useSearchPhotos('new', scoped, POPUP_PHOTOS, true);
  const total = photos.data?.total ?? cluster.count;
  return (
    <div className="card s map-popup">
      <div className="flex items-center justify-between gap-2">
        <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
          この場所 {formatCount(total)} 枚
        </div>
        <button
          type="button"
          className="chip"
          aria-label="閉じる"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
      >
        {(photos.data?.photos ?? []).map((photo, index) => (
          <Link
            key={photo.libraryFileId}
            className={`ph sq c${(index % 7) + 1}`}
            href={state.albumHref({
              view: 'photo',
              p: photo.libraryFileId,
              filter: scoped,
            })}
            style={{ display: 'block' }}
            title={photo.takenAt?.slice(0, 16).replace('T', ' ') ?? ''}
          >
            {photo.thumbRelPath ? (
              <img
                draggable={false}
                src={thumbUrl(photo.thumbRelPath)}
                alt={photo.relPath.split('/').pop() ?? ''}
              />
            ) : null}
          </Link>
        ))}
      </div>
      {total > POPUP_PHOTOS ? (
        <Button block href={state.albumHref({ view: 'all', filter: scoped })}>
          {formatCount(total)} 枚すべてを、アルバムで →
        </Button>
      ) : (
        <Button
          variant="y"
          block
          href={state.albumHref({
            view: 'photo',
            p: cluster.libraryFileId,
            filter: scoped,
          })}
        >
          拡大表示へ →
        </Button>
      )}
    </div>
  );
}

/**
 * 地図: GPS のある写真を、まとまり(件数)とピンで見せる。まとまりを押すと拡大、ピンを押すと写真。
 * 絞り込みは、アルバムと同じ条件。表示範囲の写真を、右に出し、アルバムの「すべて」で一覧できる。GPS のない写真は、載らない。
 */
export function MapView() {
  const state = useAlbumFilterState();
  const { url, filter, drawer } = state;
  const config = useMapConfig();
  // 最初の URL の位置を、地図を作るときだけ使う(以後、動かすたびに URL を更新しても、地図は、作り直さない)
  const [first] = useState(() => urlView(url.get));
  const [view, setView] = useState<View | undefined>(undefined);
  const [selected, setSelected] = useState<MapCluster | undefined>(undefined);
  const [fit, setFit] = useState<{ bounds: Bounds; key: number } | undefined>(
    undefined
  );

  const viewBounds = view
    ? boundsToString(padBounds(view.bounds, VIEW_PADDING))
    : undefined;
  const clusters = useMapClusters(viewBounds, view?.zoom ?? 0, filter);
  // 位置が URL にないとき、全部のピンの範囲へ、最初に 1 回だけ動かす
  const world = useMapClusters(first.hasView ? undefined : WORLD, 3, filter);
  const extents = useMemo(() => {
    const list = world.data?.clusters ?? [];
    if (list.length === 0) return undefined;
    return {
      south: Math.min(...list.map((c) => c.minLat)),
      north: Math.max(...list.map((c) => c.maxLat)),
      west: Math.min(...list.map((c) => c.minLon)),
      east: Math.max(...list.map((c) => c.maxLon)),
    };
  }, [world.data]);
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (!extents || fittedOnce.current || first.hasView) return;
    fittedOnce.current = true;
    setFit({ bounds: extents, key: 1 });
  }, [extents, first.hasView]);

  const facets = useAlbumFilters(filter, drawer);
  const viewBbox = view ? boundsToString(view.bounds) : undefined;
  const inView: FilterState = { ...filter, bbox: viewBbox };
  const panel = useSearchPhotos(
    'new',
    inView,
    PANEL_PHOTOS,
    view !== undefined
  );

  if (config.isError || clusters.isError) {
    return (
      <div className="page">
        <LoadError>地図を読み込めませんでした。</LoadError>
      </div>
    );
  }
  if (!config.data) return <ListSkeleton />;

  const onSelect = (cluster: MapCluster): void => {
    // 写真の小さな札(少数)・同じ位置・これ以上近づけない: その場所の写真を、札で見せる。多いまとまり(円)は、その範囲へ拡大
    if (
      cluster.count <= MAX_PHOTO_MARKER_COUNT ||
      isSinglePoint(cluster) ||
      (view?.zoom ?? 0) >= MAX_FIT_ZOOM
    ) {
      setSelected(cluster);
      return;
    }
    setSelected(undefined);
    setFit({ bounds: clusterBounds(cluster), key: (fit?.key ?? 0) + 1 });
  };

  const gps = clusters.data;
  const gpsOff = albumUrl(state, { ...EMPTY_FILTER, gps: '0' });

  return (
    <AlbumFilterProvider filter={filter} drawer={drawer}>
      <RevealPage className="page">
        <div
          className="flex flex-wrap items-end justify-between gap-6"
          data-motion="title"
        >
          <div>
            <div className="kicker">MAP / GPS</div>
            <h1 className="h1">地図</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PlaceSearch
              onPick={(place) =>
                setFit({ bounds: place.bounds, key: (fit?.key ?? 0) + 1 })
              }
            />
            <span className="chip g">
              GPS あり {gps ? formatCount(gps.withGps) : '…'}
            </span>
            <Link className="chip o" href={gpsOff}>
              GPS なし {gps ? formatCount(gps.withoutGps) : '…'} →
              アルバムで見る
            </Link>
          </div>
        </div>

        <FilterBar
          filter={filter}
          volumeLabels={
            new Map(
              (facets.data?.volumes ?? []).map((v) => [
                String(v.volumeId),
                v.label ?? `ドライブ #${v.volumeId}`,
              ])
            )
          }
          drawerOpen={drawer}
          onToggleDrawer={state.toggleDrawer}
          onChange={state.changeFilter}
        />

        <div
          className="grid items-start gap-6"
          style={{
            gridTemplateColumns: drawer
              ? 'minmax(0,1fr) 340px'
              : 'minmax(0,8fr) minmax(0,3fr)',
          }}
        >
          <MapCanvas
            config={config.data}
            initial={first.initial}
            clusters={gps?.clusters ?? []}
            selected={selected}
            fit={fit}
            onSelect={onSelect}
            onViewChange={(next) => {
              setView(next);
              url.set({
                z: next.zoom.toFixed(2),
                c: `${next.center.lat.toFixed(5)},${next.center.lon.toFixed(5)}`,
              });
            }}
          >
            {selected ? (
              <PlaceCard
                cluster={selected}
                filter={filter}
                onClose={() => setSelected(undefined)}
              />
            ) : null}
          </MapCanvas>

          <div className="flex flex-col gap-4">
            {drawer ? (
              <FilterDrawer filter={filter} onChange={state.changeFilter} />
            ) : null}
            <div className="card p">
              <div className="kicker">IN VIEW</div>
              <div className="num m" style={{ paddingTop: 6 }}>
                {panel.data ? formatCount(panel.data.total) : '…'} 件
              </div>
              <div className="mono" style={{ fontSize: 13 }}>
                地図を拡大して、範囲を絞り込む
              </div>
            </div>
            <div className="card flex flex-col gap-3">
              <div className="h2">この範囲の写真</div>
              <div className="mono" style={{ fontSize: 13 }}>
                地図に見えている範囲の写真です(
                {panel.data ? formatCount(panel.data.total) : '…'} 件のうち、
                {formatCount(panel.data?.photos.length ?? 0)}{' '}
                枚)。全部ではなく、見えていない場所の写真は、含まれません。
              </div>
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}
              >
                {(panel.data?.photos ?? []).map((photo, index) => (
                  <Link
                    key={photo.libraryFileId}
                    className={`ph sq c${(index % 7) + 1}`}
                    href={state.albumHref({
                      view: 'photo',
                      p: photo.libraryFileId,
                      filter: inView,
                    })}
                    style={{ display: 'block' }}
                  >
                    {photo.thumbRelPath ? (
                      <img
                        draggable={false}
                        src={thumbUrl(photo.thumbRelPath)}
                        alt={photo.relPath.split('/').pop() ?? ''}
                      />
                    ) : null}
                  </Link>
                ))}
              </div>
              <Button
                variant="y"
                block
                href={state.albumHref({ view: 'all', filter: inView })}
              >
                アルバムで見る →
              </Button>
            </div>
            <div className="note">
              GPS がないファイルは、地図に出しません。位置の推定は、行いません。
            </div>
          </div>
        </div>
      </RevealPage>
    </AlbumFilterProvider>
  );
}

/** 「GPS なし」を、アルバムの「すべて」で見る URL */
const albumUrl = (
  state: ReturnType<typeof useAlbumFilterState>,
  filter: FilterState
): string => state.albumHref({ view: 'all', filter });
