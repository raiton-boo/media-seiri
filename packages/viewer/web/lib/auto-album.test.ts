import { describe, expect, test } from 'bun:test';
import type { AutoAlbum } from '@file-seiri/ledger';
import { EMPTY_FILTER } from './album-filter';
import { filterOfAutoAlbum } from './auto-album';

const album = (filter: AutoAlbum['filter']): AutoAlbum => ({
  kind: 'video',
  title: 't',
  count: 1,
  unit: '本',
  cover: null,
  filter,
});

describe('filterOfAutoAlbum', () => {
  test('自動アルバムの条件を、画面の絞り込みにする', () => {
    expect(filterOfAutoAlbum(album({ kinds: ['video'] }))).toEqual({
      ...EMPTY_FILTER,
      kinds: ['video'],
    });
    expect(filterOfAutoAlbum(album({ gps: true })).gps).toBe('1');
    expect(filterOfAutoAlbum(album({ cameras: ['Canon'] })).cameras).toEqual([
      'Canon',
    ]);
    expect(
      filterOfAutoAlbum(album({ dateSources: ['json', 'filename'] })).sources
    ).toEqual(['json', 'filename']);
    expect(
      filterOfAutoAlbum(album({ precisions: ['none'] })).precisions
    ).toEqual(['none']);
    expect(filterOfAutoAlbum(album({ livePhotos: true })).live).toBe('1');
  });
});
