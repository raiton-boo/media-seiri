/** LIKE の特別な文字(`\` `%` `_`)を、文字どおりに扱うための、エスケープ(`ESCAPE '\'` と使う) */
const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, (character) => `\\${character}`);

/** 前方一致の LIKE の値 */
export const likePrefix = (prefix: string): string => `${escapeLike(prefix)}%`;

/** 部分一致の LIKE の値 */
export const likeContains = (part: string): string => `%${escapeLike(part)}%`;
