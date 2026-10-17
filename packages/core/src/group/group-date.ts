import type { DateResolution, DateSource } from '../date/index.ts';
import type { FileGroup, GroupMember } from './group.ts';

// 取得元の確かさ(大きいほど優先)。EXIF・動画 > Takeout の json > ファイル名 > なし
const SOURCE_RANK: Record<DateSource, number> = {
  exif: 4,
  video: 4,
  json: 3,
  filename: 2,
  none: 0,
};
const PRECISION_RANK: Record<DateResolution['precision'], number> = {
  full: 4,
  date: 3,
  month: 2,
  year: 1,
  invalid: 0,
  none: 0,
};

const isValid = (resolution: DateResolution): boolean =>
  resolution.precision !== 'none' && resolution.precision !== 'invalid';

/** 「どちらが、日付の決め手として優れているか」を比べる。正なら a が優れている */
const compareQuality = (a: DateResolution, b: DateResolution): number => {
  if (isValid(a) !== isValid(b)) return isValid(a) ? 1 : -1;
  const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (bySource !== 0) return bySource;
  return PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision];
};

/** 名前順(コードの順)。同じ品質のとき、結果が、毎回同じになるようにするため */
const compareFileName = (a: GroupMember, b: GroupMember): number =>
  a.file.fileName < b.file.fileName
    ? -1
    : a.file.fileName > b.file.fileName
      ? 1
      : 0;

export type GroupDate = {
  /** グループの全員に当てる、日付の決定の結果 */
  resolution: DateResolution;
  /** 日付を決めたファイル(出力名の元の語幹を持つ代表) */
  representative: GroupMember;
};

/**
 * グループの日付を、1 回だけ決める(`date-resolution.md` §8)。
 * 取得元が確かなもの(EXIF・動画 > json > ファイル名)を優先し、同じなら精度の高いもの、
 * それでも同じなら、名前順で先頭のファイル。どれも有効でなければ、無効(invalid)があれば invalid、なければ none。
 * @param resolutions ファイルの識別子(`SourceFile.id`)ごとの、日付の決定の結果
 */
export const resolveGroupDate = (
  group: FileGroup,
  resolutions: ReadonlyMap<string, DateResolution>
): GroupDate => {
  let best: { member: GroupMember; resolution: DateResolution } | undefined;
  let sawInvalid = false;

  for (const member of group.members) {
    const resolution = resolutions.get(member.file.id);
    if (!resolution)
      throw new Error(`日付の決定の結果がない: ${member.file.id}`);
    if (resolution.precision === 'invalid') sawInvalid = true;
    if (!best) {
      best = { member, resolution };
      continue;
    }
    const comparison = compareQuality(resolution, best.resolution);
    if (
      comparison > 0 ||
      (comparison === 0 && compareFileName(member, best.member) < 0)
    ) {
      best = { member, resolution };
    }
  }
  if (!best) throw new Error('メンバーがいないグループ');
  // どれも有効でないとき、無効な値が 1 つでもあれば invalid(日付なしより、強い情報)
  if (
    !isValid(best.resolution) &&
    sawInvalid &&
    best.resolution.precision === 'none'
  ) {
    const invalid = group.members
      .map((member) => ({
        member,
        resolution: resolutions.get(member.file.id),
      }))
      .find((entry) => entry.resolution?.precision === 'invalid');
    if (invalid?.resolution)
      return { resolution: invalid.resolution, representative: invalid.member };
  }
  return { resolution: best.resolution, representative: best.member };
};
