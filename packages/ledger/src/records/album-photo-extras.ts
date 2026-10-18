import type { Database } from 'bun:sqlite';

/** 取り込み元(ソース側)に残っているはずの、同じ内容のファイル。原本を探すときの候補 */
export type SourceCopy = {
  volumeUuid: string;
  volumeLabel: string | null;
  /** ドライブの根からの相対パス */
  relPath: string;
  sizeBytes: number;
  /** 取り込んだときの更新日(ミリ秒)。一致するときだけ、同じファイルとみなす */
  mtimeMs: number;
};

/**
 * 同じ内容のソース側のファイル(ZIP の中・コピーしなかったものを除く)。新しい実行のものが先。
 * 見つかっても、いま接続されているか・サイズと更新日が一致するかは、呼び出し側が確かめる。
 */
export const listSourceCopies = (
  db: Database,
  libraryFileId: number
): SourceCopy[] =>
  db
    .query<SourceCopy, [number]>(
      `SELECT v.volume_uuid AS volumeUuid, v.label AS volumeLabel, sf.rel_path AS relPath,
              sf.size_bytes AS sizeBytes, sf.mtime_ms AS mtimeMs
       FROM library_files AS f
       JOIN source_files AS sf ON sf.content_id = f.content_id
       JOIN volumes AS v ON v.volume_id = sf.volume_id
       WHERE f.library_file_id = ? AND sf.container_id IS NULL
         AND sf.state IN ('done', 'duplicate')
       ORDER BY sf.run_id DESC`
    )
    .all(libraryFileId);

/** 「この日の他の年」: 同じ月日に撮った、ほかの年の写真(年ごとに、枚数と代表の 1 枚) */
export type SameDayYear = {
  year: number;
  count: number;
  libraryFileId: number;
  thumbRelPath: string | null;
};

/**
 * 日まで分かる写真の、同じ月日・ほかの年(新しい年が先)。日まで分からない写真(年・月だけ)は、対象外。
 * 代表は、その年・その日の、いちばん早い 1 枚(サムネイルがあるものを優先)。
 */
export const listSameDayOtherYears = (
  db: Database,
  libraryFileId: number
): { monthDay: string; years: SameDayYear[] } | undefined => {
  const base = db
    .query<{ takenAt: string | null }, [number]>(
      `SELECT m.taken_at AS takenAt FROM library_files AS f
       JOIN media_metadata AS m ON m.content_id = f.content_id WHERE f.library_file_id = ?`
    )
    .get(libraryFileId);
  if (!base?.takenAt || base.takenAt.length < 10) return undefined;
  const year = Number(base.takenAt.slice(0, 4));
  const monthDay = base.takenAt.slice(5, 10);
  const rows = db
    .query<
      {
        year: number;
        libraryFileId: number;
        thumbRelPath: string | null;
        takenAt: string;
      },
      [string]
    >(
      `SELECT CAST(substr(m.taken_at, 1, 4) AS INTEGER) AS year, f.library_file_id AS libraryFileId,
              f.thumb_rel_path AS thumbRelPath, m.taken_at AS takenAt
       FROM library_files AS f JOIN media_metadata AS m ON m.content_id = f.content_id
       WHERE length(m.taken_at) >= 10 AND substr(m.taken_at, 6, 5) = ?
         AND lower(f.rel_path) NOT LIKE '%.xmp'
       ORDER BY year DESC, (f.thumb_rel_path IS NULL), m.taken_at, f.library_file_id`
    )
    .all(monthDay);
  const years = new Map<number, SameDayYear>();
  for (const row of rows) {
    if (row.year === year) continue;
    const found = years.get(row.year);
    if (found) found.count += 1;
    else
      years.set(row.year, {
        year: row.year,
        count: 1,
        libraryFileId: row.libraryFileId,
        thumbRelPath: row.thumbRelPath,
      });
  }
  return { monthDay, years: [...years.values()] };
};
