import { describe, expect, test } from 'bun:test';
import { groupFiles, type SourceFile } from './group.ts';

const file = (
  id: string,
  fileName: string,
  directory = '/src/a'
): SourceFile => ({ id, directory, fileName });

describe('groupFiles(仕様書 §2-3)', () => {
  test('RAW+JPEG+xmp は、1 つのグループ', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.CR3'),
      file('2', 'IMG_0001.JPG'),
      file('3', 'IMG_0001.xmp'),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members.map((member) => member.file.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  test('ライブフォト(HEIC + MOV)も、1 つのグループ', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.HEIC'),
      file('2', 'IMG_0001.MOV'),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  test('語幹が違えば、別のグループ', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.JPG'),
      file('2', 'IMG_0002.JPG'),
    ]);
    expect(result.groups).toHaveLength(2);
  });

  test('フォルダが違えば、語幹が同じでも、別のグループ', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.JPG', '/src/a'),
      file('2', 'IMG_0001.JPG', '/src/b'),
    ]);
    expect(result.groups).toHaveLength(2);
  });

  test('語幹の比較は、大文字小文字を区別しない', () => {
    const result = groupFiles([
      file('1', 'IMG_1234.JPG'),
      file('2', 'img_1234.cr3'),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  test('`-video-paired` の接尾辞がついた動画は、接尾辞を除いた語幹のグループに入る', () => {
    const result = groupFiles([
      file('1', 'IMG_1234.JPG'),
      file('2', 'IMG_1234-video-paired.mov'),
    ]);
    expect(result.groups).toHaveLength(1);
    const video = result.groups[0]?.members.find(
      (member) => member.file.id === '2'
    );
    expect(video?.stem).toBe('IMG_1234');
  });

  test('接尾辞の一覧は、設定で足せる', () => {
    const result = groupFiles([file('1', 'A.JPG'), file('2', 'A_live.mov')], {
      pairedSuffixes: ['_live'],
    });
    expect(result.groups).toHaveLength(1);
  });

  test('NFC と NFD で書いた同じ名前は、同じグループ', () => {
    const result = groupFiles([
      file('1', `${'が'.normalize('NFD')}.JPG`),
      file('2', `${'が'.normalize('NFC')}.CR3`),
    ]);
    expect(result.groups).toHaveLength(1);
  });

  test('拡張子も同じ(大文字小文字を除く)ファイルは、別のグループに分ける(同じ出力名になるため)', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.JPG'),
      file('2', 'img_0001.jpg'),
      file('3', 'IMG_0001.CR3'),
    ]);
    expect(result.groups).toHaveLength(2);
    // 名前順で、先頭の JPG(大文字が先)と CR3 が、同じグループ。2 つ目の jpg は、別のグループ
    const sizes = result.groups.map((group) =>
      group.members.map((member) => member.file.id).sort()
    );
    expect(sizes).toEqual([['1', '3'], ['2']]);
  });

  test('分けたあとの結果は、入力の順番に左右されない', () => {
    const files = [
      file('1', 'IMG_0001.JPG'),
      file('2', 'img_0001.jpg'),
      file('3', 'IMG_0001.CR3'),
    ];
    const forward = groupFiles(files).groups.map((group) =>
      group.members.map((member) => member.file.id).sort()
    );
    const backward = groupFiles([...files].reverse()).groups.map((group) =>
      group.members.map((member) => member.file.id).sort()
    );
    expect(backward.sort()).toEqual(forward.sort());
  });

  test('RAW のない .xmp は、グループにせず、孤立として返す', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.JPG'),
      file('2', 'IMG_0001.xmp'),
      file('3', 'IMG_0002.xmp'),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.members.map((member) => member.file.id)).toEqual([
      '1',
    ]);
    expect(result.orphanSidecars.map((entry) => entry.id).sort()).toEqual([
      '2',
      '3',
    ]);
  });

  test('対象外の拡張子と Takeout の .json は、others にまとめる', () => {
    const result = groupFiles([
      file('1', 'IMG_0001.JPG'),
      file('2', 'IMG_0001.aae'),
      file('3', 'IMG_0001.JPG.json'),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.others.map((entry) => entry.id).sort()).toEqual(['2', '3']);
  });
});
