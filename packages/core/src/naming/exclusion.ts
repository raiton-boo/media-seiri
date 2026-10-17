// スキャンで、取り込みの対象にしないもの(仕様書 §1-2)
const EXCLUDED_NAMES = new Set(
  [
    '.DS_Store',
    'Thumbs.db',
    '.Trashes',
    '.Spotlight-V100',
    '.fseventsd',
    '$RECYCLE.BIN',
    'System Volume Information',
  ].map((name) => name.toLowerCase())
);

const APPLE_DOUBLE_PREFIX = '._';
const PHOTOS_LIBRARY_SUFFIX = '.photoslibrary';

/**
 * ドライブの管理用ファイル・フォルダ、macOS の写真アプリのライブラリは、取り込みの対象にしない。
 * - `._*`: macOS が FAT32・exFAT に、書いたファイルごとに作る付属ファイル。写真と同じ拡張子のため、除かないと、
 *   日付の取れない写真として数えてしまう。
 * - `*.photoslibrary`: 中身が管理用の構造で、ソースとして取り込む対象ではない。
 */
export const isExcludedName = (name: string): boolean => {
  const lowerName = name.toLowerCase();
  return (
    name.startsWith(APPLE_DOUBLE_PREFIX) ||
    lowerName.endsWith(PHOTOS_LIBRARY_SUFFIX) ||
    EXCLUDED_NAMES.has(lowerName)
  );
};
