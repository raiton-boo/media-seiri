/** 取り込みの対象かどうかの区分(仕様書 §1-1) */
export type FileKind =
  | 'photo'
  | 'raw'
  | 'video'
  // `.xmp`: RAW と同名のものを、隣にコピーする
  | 'xmp'
  // `.json`: Takeout の日付・GPS を読むだけ(コピーしない)。Takeout のものかは、呼び出し側が判断する
  | 'json'
  // 上記以外(`.aae`、`.thm`、`.lrv` など)。件数だけ記録する
  | 'unsupported';

const PHOTO_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'tif',
  'tiff',
  'gif',
  'webp',
];
const RAW_EXTENSIONS = [
  'cr2',
  'cr3',
  'nef',
  'arw',
  'dng',
  'raf',
  'orf',
  'rw2',
  'pef',
  'srw',
  'raw',
];
const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mts',
  'm2ts',
  'mkv',
  '3gp',
  'wmv',
  'm2t',
  'webm',
  'mpg',
  'mpeg',
];

const KIND_BY_EXTENSION = new Map<string, FileKind>([
  ...PHOTO_EXTENSIONS.map((extension): [string, FileKind] => [
    extension,
    'photo',
  ]),
  ...RAW_EXTENSIONS.map((extension): [string, FileKind] => [extension, 'raw']),
  ...VIDEO_EXTENSIONS.map((extension): [string, FileKind] => [
    extension,
    'video',
  ]),
  ['xmp', 'xmp'],
  ['json', 'json'],
]);

/** ファイル名の拡張子(ドットなし、小文字)。拡張子がなければ、空の文字列 */
export const extensionOf = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toLowerCase();
};

/** 拡張子を除いた、ファイル名の語幹 */
export const stemOf = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return fileName;
  return fileName.slice(0, dotIndex);
};

/**
 * 拡張子から、取り込みの対象かどうかを決める。大文字小文字は区別しない。
 * `additionalExtensions`: 設定で足した拡張子(仕様書 §1-1: 拡張子は、設定で追加できる)
 */
export const classifyFile = (
  fileName: string,
  additionalExtensions: ReadonlyMap<string, FileKind> = new Map()
): FileKind => {
  const extension = extensionOf(fileName);
  return (
    additionalExtensions.get(extension) ??
    KIND_BY_EXTENSION.get(extension) ??
    'unsupported'
  );
};
