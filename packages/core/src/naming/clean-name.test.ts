import { describe, expect, test } from 'bun:test';
import { avoidReservedName, cleanOriginalName } from './clean-name.ts';

describe('cleanOriginalName(仕様書 §2-2)', () => {
  test('ふつうの名前は、そのまま', () => {
    expect(cleanOriginalName('IMG_0412')).toBe('IMG_0412');
    expect(cleanOriginalName('スマホ2014年4月～6月')).toBe(
      'スマホ2014年4月～6月'
    );
  });

  test('使えない文字は、`_` に置き換える', () => {
    expect(cleanOriginalName('a<b>c:d"e/f\\g|h?i*j')).toBe(
      'a_b_c_d_e_f_g_h_i_j'
    );
  });

  test('制御文字も、`_` に置き換える', () => {
    expect(cleanOriginalName('a\u0000b\u001fc\u007fd')).toBe('a_b_c_d');
  });

  test('先頭・末尾の空白とピリオドは、取り除く', () => {
    expect(cleanOriginalName('  IMG_0001  ')).toBe('IMG_0001');
    expect(cleanOriginalName('..IMG_0001..')).toBe('IMG_0001');
    expect(cleanOriginalName(' . IMG . ')).toBe('IMG');
  });

  test('途中の空白とピリオドは、残す', () => {
    expect(cleanOriginalName('Photo 2014.04 (1)')).toBe('Photo 2014.04 (1)');
  });

  test('60 文字を超えたら、先頭の 60 文字に切る(文字数で数える)', () => {
    expect(cleanOriginalName('a'.repeat(100))).toBe('a'.repeat(60));
    const japanese = 'あ'.repeat(100);
    expect(Array.from(cleanOriginalName(japanese))).toHaveLength(60);
  });

  test('60 文字ちょうどは、そのまま', () => {
    expect(cleanOriginalName('b'.repeat(60))).toBe('b'.repeat(60));
  });

  test('切ったあとに、末尾が空白やピリオドになったら、取り除く', () => {
    expect(cleanOriginalName(`${'a'.repeat(59)}. tail`)).toBe('a'.repeat(59));
  });

  test('絵文字などの、2 つのコードで表す文字も、1 文字と数える', () => {
    expect(Array.from(cleanOriginalName('😀'.repeat(100)))).toHaveLength(60);
  });

  test('NFC にそろえる(濁点を分けて書いた「が」は、1 文字の「が」になる)', () => {
    const decomposed = 'が'.normalize('NFD');
    expect(decomposed).not.toBe('が');
    expect(cleanOriginalName(decomposed)).toBe('が');
  });

  test('空になったら、unnamed', () => {
    expect(cleanOriginalName('')).toBe('unnamed');
    expect(cleanOriginalName('...')).toBe('unnamed');
    expect(cleanOriginalName('   ')).toBe('unnamed');
  });
});

describe('avoidReservedName(Windows の予約名)', () => {
  test('予約名は、先頭に `_` を付ける(拡張子がついても、デバイス名として扱われるため)', () => {
    expect(avoidReservedName('CON.jpg')).toBe('_CON.jpg');
    expect(avoidReservedName('nul.mov')).toBe('_nul.mov');
    expect(avoidReservedName('COM1.jpg')).toBe('_COM1.jpg');
    expect(avoidReservedName('lpt9.png')).toBe('_lpt9.png');
  });

  test('予約名を含むだけの名前は、そのまま', () => {
    expect(avoidReservedName('CONTENT.jpg')).toBe('CONTENT.jpg');
    expect(avoidReservedName('COM10.jpg')).toBe('COM10.jpg');
    expect(avoidReservedName('2014.04.06_CON.jpg')).toBe('2014.04.06_CON.jpg');
  });
});
