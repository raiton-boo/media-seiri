import {
  classifyFile,
  extensionOf,
  type FileKind,
  stemOf,
} from '../naming/files.ts';

/** ソースにあるファイル。`directory` は、同じ名前のファイルが、同じグループになる範囲(ソースのフォルダ。ZIP の中なら、ZIP のパスと中のフォルダ) */
export type SourceFile = {
  /** 呼び出し側が、ファイルを見分けるための識別子 */
  id: string;
  directory: string;
  fileName: string;
};

export type GroupMember = {
  file: SourceFile;
  kind: Exclude<FileKind, 'unsupported' | 'json'>;
  /** 接尾辞(`-video-paired` など)を除いた、元の語幹。出力名に使う */
  stem: string;
};

export type FileGroup = {
  /** ソースのフォルダ + 比較用の語幹(大文字小文字を区別しない) */
  key: string;
  members: GroupMember[];
};

export type GroupingResult = {
  groups: FileGroup[];
  /** 同じグループに RAW がない `.xmp`(コピーしない) */
  orphanSidecars: SourceFile[];
  /** 対象外の拡張子、または Takeout の `.json`(グループにしない) */
  others: SourceFile[];
};

export type GroupingOptions = {
  /** 語幹から取り除く接尾辞。既定は、実データで見つかった `-video-paired` */
  pairedSuffixes?: readonly string[];
  /** 設定で足した拡張子 */
  additionalExtensions?: ReadonlyMap<string, FileKind>;
};

export const DEFAULT_PAIRED_SUFFIXES = ['-video-paired'] as const;

/** 語幹の末尾にある接尾辞(大文字小文字を区別しない)を、1 つだけ取り除く */
const removePairedSuffix = (
  stem: string,
  suffixes: readonly string[]
): string => {
  const lowerStem = stem.toLowerCase();
  for (const suffix of suffixes) {
    if (
      lowerStem.endsWith(suffix.toLowerCase()) &&
      stem.length > suffix.length
    ) {
      return stem.slice(0, stem.length - suffix.length);
    }
  }
  return stem;
};

const groupKey = (directory: string, stem: string): string =>
  `${directory}\u0000${stem.normalize('NFC').toLowerCase()}`;

/**
 * 拡張子(大文字小文字を除く)が重なるメンバーは、別のグループに分ける。
 * 大文字小文字を区別するドライブに、`IMG_0001.JPG` と `img_0001.jpg` があるとき、同じグループにすると、
 * 出力の名前が同じになり、連番でも区別できないため。名前順で、2 つ目以降を、別のグループにする。
 */
const splitByExtension = (key: string, members: GroupMember[]): FileGroup[] => {
  const sorted = [...members].sort((a, b) =>
    a.file.fileName < b.file.fileName
      ? -1
      : a.file.fileName > b.file.fileName
        ? 1
        : 0
  );
  const buckets: GroupMember[][] = [];
  for (const member of sorted) {
    const extension = extensionOf(member.file.fileName);
    const target = buckets.find(
      (bucket) =>
        !bucket.some((other) => extensionOf(other.file.fileName) === extension)
    );
    if (target) target.push(member);
    else buckets.push([member]);
  }
  return buckets.map((bucket, index) => ({
    key: index === 0 ? key : `${key}\u0000#${index + 1}`,
    members: bucket,
  }));
};

/**
 * ファイルを、同名グループにまとめる(仕様書 §2-3)。
 * 同じフォルダにある、元の語幹が同じファイル(RAW+JPEG、ライブフォトなど)は、1 つのグループ。
 * 語幹の比較は、大文字小文字を区別しない。`.xmp` は、同じグループに RAW があるときだけ、仲間にする。
 */
export const groupFiles = (
  files: readonly SourceFile[],
  options: GroupingOptions = {}
): GroupingResult => {
  const suffixes = options.pairedSuffixes ?? DEFAULT_PAIRED_SUFFIXES;
  const groups = new Map<string, FileGroup>();
  const others: SourceFile[] = [];

  for (const file of files) {
    const kind = classifyFile(file.fileName, options.additionalExtensions);
    if (kind === 'unsupported' || kind === 'json') {
      others.push(file);
      continue;
    }
    const stem = removePairedSuffix(stemOf(file.fileName), suffixes);
    const key = groupKey(file.directory, stem);
    const group = groups.get(key) ?? { key, members: [] };
    group.members.push({ file, kind, stem });
    groups.set(key, group);
  }

  const orphanSidecars: SourceFile[] = [];
  const result: FileGroup[] = [];
  for (const group of groups.values()) {
    const hasRaw = group.members.some((member) => member.kind === 'raw');
    const members = group.members.filter((member) => {
      if (member.kind !== 'xmp' || hasRaw) return true;
      orphanSidecars.push(member.file);
      return false;
    });
    result.push(...splitByExtension(group.key, members));
  }
  return { groups: result, orphanSidecars, others };
};
