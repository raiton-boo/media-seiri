/** ZIP のエントリ名の、文字コードの判定と、安全な相対パスへの変換(`zip-handling.md` §5・§6) */

const utf8 = new TextDecoder('utf-8', { fatal: true });
const cp932 = new TextDecoder('shift_jis');

const isAscii = (bytes: Uint8Array): boolean =>
  bytes.every((byte) => byte < 0x80);

/**
 * エントリ名のバイト列を、文字列にする。
 * - UTF-8 の印(一般目的ビット 11、または、Unicode のパス)があれば、UTF-8。
 * - 印がなければ: ASCII だけなら、そのまま。ASCII 以外を含むとき、UTF-8 として正しく読めるなら UTF-8、読めなければ cp932(Shift_JIS)。
 *   どちらでも読める曖昧なものは、UTF-8 を採る(cp932 のバイト列が、偶然、正しい UTF-8 になることは、まれ)。
 * 結果は、NFC に統一する(Windows 由来の NFD を、そろえる)。
 */
export const decodeEntryName = (
  bytes: Uint8Array,
  utf8Flag: boolean
): string => {
  let text: string;
  if (utf8Flag || isAscii(bytes)) {
    text = new TextDecoder('utf-8').decode(bytes);
  } else {
    try {
      text = utf8.decode(bytes);
    } catch {
      text = cp932.decode(bytes);
    }
  }
  return text.normalize('NFC');
};

export type SafePath =
  | { ok: true; segments: string[] }
  | { ok: false; reason: string };

/**
 * エントリ名を、安全な相対パスにする。展開先の外に出る形(`../`・絶対パス・ドライブ名・NUL)は、拒む。
 * `\` は、区切りとして扱わない(Windows 由来の ZIP は、`/` で保存する決まり。`\` を含む名前は、そのままの名前の一部)が、
 * `..` を `\` で隠した形(`..\x`)は、拒む。空の部分・`.` は、除く。
 */
export const safeSegments = (name: string): SafePath => {
  if (name.includes('\0')) return { ok: false, reason: 'NUL を含む名前' };
  if (name.startsWith('/')) return { ok: false, reason: '絶対パス' };
  if (/^[a-zA-Z]:/.test(name))
    return { ok: false, reason: 'ドライブ名つきのパス' };
  const segments: string[] = [];
  for (const part of name.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' || part.split('\\').includes('..'))
      return { ok: false, reason: '上の階層へ出るパス(..)' };
    segments.push(part);
  }
  if (segments.length === 0) return { ok: false, reason: '空の名前' };
  return { ok: true, segments };
};
