import type { MediaKind } from '@file-seiri/ledger';

/** パスが属するボリュームの情報 */
export type VolumeInfo = {
  /** ドライブの固有 ID。名前ではなく、これで識別する(仕様書 §9-1) */
  volumeUuid: string;
  label: string;
  /** `exfat` / `fat32` / `fat16` / `fat` / `ntfs` / `apfs` / `hfs` など(小文字) */
  fsType: string;
  /** マウント先(`df` が返したもの) */
  mountPoint: string;
  /**
   * ボリューム内の相対パスの、基準になる場所。通常は、マウント先と同じ。
   * 内蔵の Data ボリューム(`/System/Volumes/Data`)は、`/Users/...` のように `/` から見えるため、`/`。
   */
  rootPath: string;
  deviceNode: string;
  isWritable: boolean;
  isInternal: boolean;
  /** 種類。USB でつながっていれば `usb`、そうでなければ SSD かどうか。分からなければ undefined */
  mediaKind: MediaKind | undefined;
  totalBytes: number;
  freeBytes: number;
};
