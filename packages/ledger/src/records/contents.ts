import type { Database } from 'bun:sqlite';

export type Content = {
  contentId: number;
  /** SHA-256 の 16 進(小文字) */
  hash: string;
  sizeBytes: number;
};

const COLUMNS = 'content_id AS contentId, hash, size_bytes AS sizeBytes';

export const findContentByHash = (
  db: Database,
  hash: string
): Content | undefined =>
  db
    .query<Content, [string]>(`SELECT ${COLUMNS} FROM contents WHERE hash = ?`)
    .get(hash) ?? undefined;

export const getContent = (
  db: Database,
  contentId: number
): Content | undefined =>
  db
    .query<Content, [number]>(
      `SELECT ${COLUMNS} FROM contents WHERE content_id = ?`
    )
    .get(contentId) ?? undefined;

/**
 * ハッシュの内容を、1 行だけ持つ。なければ追加し、あればそれを返す(`isNew` で見分ける)。
 * 同じハッシュで、サイズが違うときは、壊れたデータのため、エラーにする。
 */
export const getOrCreateContent = (
  db: Database,
  input: { hash: string; sizeBytes: number }
): { content: Content; isNew: boolean } => {
  const inserted = db
    .query<Content, [string, number]>(
      `INSERT INTO contents (hash, size_bytes) VALUES (?, ?)
       ON CONFLICT (hash) DO NOTHING RETURNING ${COLUMNS}`
    )
    .get(input.hash, input.sizeBytes);
  if (inserted) return { content: inserted, isNew: true };

  const existing = findContentByHash(db, input.hash);
  if (!existing) throw new Error('内容を保存できませんでした');
  if (existing.sizeBytes !== input.sizeBytes) {
    throw new Error(
      `同じハッシュで、サイズが違います: ${input.hash}(${existing.sizeBytes} と ${input.sizeBytes})`
    );
  }
  return { content: existing, isNew: false };
};
