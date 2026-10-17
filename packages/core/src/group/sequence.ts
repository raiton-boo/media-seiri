import { extensionOf } from '../naming/files.ts';
import {
  buildPlacement,
  type Placement,
  targetFromResolution,
} from '../naming/placement.ts';
import type { FileGroup, SourceFile } from './group.ts';
import type { GroupDate } from './group-date.ts';

export type GroupPlacement = { file: SourceFile; placement: Placement };

const MAX_SEQUENCE = 9999;

/** ライブラリの根からの、ファイルのパス(`/` 区切り) */
export const placementPath = (placement: Placement): string =>
  `${placement.directory}/${placement.fileName}`;

/**
 * グループの全員の、置き場所とファイル名を決める。全員が、同じフォルダと、同じ語幹を共有する
 * (語幹は、代表の元の語幹。拡張子だけが、メンバーごとに違う)。
 * @param sequence 衝突したときの連番(1 から)
 */
export const placeGroup = (
  group: FileGroup,
  date: GroupDate,
  sequence?: number
): GroupPlacement[] => {
  const target = targetFromResolution(date.resolution);
  return group.members.map((member) => {
    const extension = extensionOf(member.file.fileName);
    const originalFileName =
      extension === ''
        ? date.representative.stem
        : `${date.representative.stem}.${extension}`;
    return {
      file: member.file,
      placement: buildPlacement(target, originalFileName, sequence),
    };
  });
};

/**
 * 衝突しない、最初の連番を選ぶ(仕様書 §2-3・§2-4)。
 * 「グループの全ての拡張子が空いている最初の語幹」を選ぶ。1 つでも埋まっていれば、次の連番に進む。
 * 連番なし → 1 → 2 → … の順に試す。
 * @param isTaken 出力先に実在する、または、今回の実行で予約済みの名前か。引数は、ライブラリの根からのパス。
 *   exFAT などは、大文字小文字を区別しないため、呼び出し側は、区別せずに比べる。
 */
export const choosePlacements = (
  group: FileGroup,
  date: GroupDate,
  isTaken: (path: string) => boolean
): { sequence: number | undefined; placements: GroupPlacement[] } => {
  const candidates: (number | undefined)[] = [
    undefined,
    ...Array.from({ length: MAX_SEQUENCE }, (_, index) => index + 1),
  ];
  for (const sequence of candidates) {
    const placements = placeGroup(group, date, sequence);
    const paths = placements.map((entry) => placementPath(entry.placement));
    // メンバー同士が同じ名前になるのは、連番では解決できない(グループの作り方の誤り)ため、すぐにエラーにする
    const lowerPaths = new Set(paths.map((path) => path.toLowerCase()));
    if (lowerPaths.size !== paths.length) {
      throw new Error(
        `グループの中で、同じ名前になるメンバーがいる: ${group.key}`
      );
    }
    if (paths.every((path) => !isTaken(path))) return { sequence, placements };
  }
  throw new Error(
    `空いている名前が見つからない(連番が ${MAX_SEQUENCE} を超えた): ${group.key}`
  );
};
