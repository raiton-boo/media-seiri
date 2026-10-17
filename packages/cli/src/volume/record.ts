import type { Database } from 'bun:sqlite';
import { upsertVolume, type Volume } from '@file-seiri/ledger';
import type { VolumeInfo } from './types.ts';

/** ボリュームを台帳に記録する(固有 ID が同じなら、最後に見た時刻などを更新する) */
export const recordVolume = (
  db: Database,
  info: VolumeInfo,
  seenAt: Date
): Volume =>
  upsertVolume(db, {
    volumeUuid: info.volumeUuid,
    label: info.label || undefined,
    fsType: info.fsType,
    mediaKind: info.mediaKind,
    seenAt,
  });
