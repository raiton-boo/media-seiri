// 元の名前の整え方(仕様書 §2-2)
const MAX_CHARACTERS = 60;
const REPLACEMENT = '_';
const EMPTY_NAME = 'unnamed';

// Windows で使えない文字(`< > : " / \ | ? *`)
const INVALID_CHARACTERS = new Set([
  '<',
  '>',
  ':',
  '"',
  '/',
  '\\',
  '|',
  '?',
  '*',
]);
// 制御文字(0x00〜0x1f と 0x7f)
const MAX_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;
const EDGE_SPACES_AND_DOTS = /^[\s.]+|[\s.]+$/g;
// Windows の予約名(拡張子がついても、デバイス名として扱われる)
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 使えない文字と制御文字を、`_` に置き換える(1 文字ずつ) */
const replaceIfInvalid = (character: string): string => {
  const code = character.codePointAt(0) ?? 0;
  return INVALID_CHARACTERS.has(character) ||
    code <= MAX_CONTROL_CODE ||
    code === DELETE_CODE
    ? REPLACEMENT
    : character;
};

/**
 * 元の名前(拡張子を除いたファイル名)を、保存先で使える形に整える。
 * 1. NFC にそろえる(macOS と Windows の間で、同じ名前が別物にならないように)
 * 2. 使えない文字を `_` に置き換える
 * 3. 先頭・末尾の空白とピリオドを取り除く(Windows で使えない)
 * 4. 60 文字(Unicode の文字数)までに切る
 * 5. 空になったら `unnamed`
 */
export const cleanOriginalName = (stem: string): string => {
  const replaced = Array.from(stem.normalize('NFC'), replaceIfInvalid)
    .join('')
    .replace(EDGE_SPACES_AND_DOTS, '');
  // 切ったあとに、末尾が空白やピリオドになることがあるため、もう一度取り除く
  const capped = Array.from(replaced)
    .slice(0, MAX_CHARACTERS)
    .join('')
    .replace(EDGE_SPACES_AND_DOTS, '');
  return capped === '' ? EMPTY_NAME : capped;
};

/**
 * 名前の最初のピリオドの前が、Windows の予約名なら、先頭に `_` を付ける。
 * 日付の部分が付く名前では、起きない。日付の部分が付かない `_unknown/` の名前のために使う。
 */
export const avoidReservedName = (fileName: string): string => {
  const firstSegment = fileName.split('.')[0] ?? fileName;
  return WINDOWS_RESERVED_NAMES.test(firstSegment) ? `_${fileName}` : fileName;
};
