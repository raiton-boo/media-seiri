import type { Database } from 'bun:sqlite';
import { formatTimestamp } from './time.ts';

export type MediaKind = 'hdd' | 'ssd' | 'usb';

export type Volume = {
  volumeId: number;
  volumeUuid: string;
  label: string | null;
  fsType: string | null;
  mediaKind: MediaKind | null;
  lastSeenAt: string;
};

export type VolumeInput = {
  /** ドライブの固有 ID。名前ではなく、これで識別する */
  volumeUuid: string;
  label?: string;
  fsType?: string;
  mediaKind?: MediaKind;
  /** いま、接続を確かめた時刻 */
  seenAt: Date;
};

const COLUMNS = `volume_id AS volumeId, volume_uuid AS volumeUuid, label,
  fs_type AS fsType, media_kind AS mediaKind, last_seen_at AS lastSeenAt`;

/** ボリュームを追加する。同じ固有 ID があれば、最後に見た時刻を更新する(指定した項目だけ、上書きする) */
export const upsertVolume = (db: Database, input: VolumeInput): Volume => {
  const row = db
    .query<Volume, Record<string, string | null>>(
      `INSERT INTO volumes (volume_uuid, label, fs_type, media_kind, last_seen_at)
       VALUES ($volumeUuid, $label, $fsType, $mediaKind, $seenAt)
       ON CONFLICT (volume_uuid) DO UPDATE SET
         label = COALESCE(excluded.label, label),
         fs_type = COALESCE(excluded.fs_type, fs_type),
         media_kind = COALESCE(excluded.media_kind, media_kind),
         last_seen_at = excluded.last_seen_at
       RETURNING ${COLUMNS}`
    )
    .get({
      volumeUuid: input.volumeUuid,
      label: input.label ?? null,
      fsType: input.fsType ?? null,
      mediaKind: input.mediaKind ?? null,
      seenAt: formatTimestamp(input.seenAt),
    });
  if (!row) throw new Error('ボリュームを保存できませんでした');
  return row;
};

export const getVolume = (db: Database, volumeId: number): Volume | undefined =>
  db
    .query<Volume, [number]>(
      `SELECT ${COLUMNS} FROM volumes WHERE volume_id = ?`
    )
    .get(volumeId) ?? undefined;

export const findVolumeByUuid = (
  db: Database,
  volumeUuid: string
): Volume | undefined =>
  db
    .query<Volume, [string]>(
      `SELECT ${COLUMNS} FROM volumes WHERE volume_uuid = ?`
    )
    .get(volumeUuid) ?? undefined;
