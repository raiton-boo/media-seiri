import { describe, expect, test } from 'bun:test';
import { renderToString } from 'ink';
import { moveIndex, SelectView, TextView, windowRange } from './prompts.tsx';

const items = Array.from({ length: 30 }, (_, index) => ({
  label: `フォルダ${index}/`,
}));

describe('選ぶ画面の動き', () => {
  test('矢印で動かすと、端から先は、反対側へ回る', () => {
    expect(moveIndex(0, 5, -1)).toBe(4);
    expect(moveIndex(4, 5, 1)).toBe(0);
    expect(moveIndex(2, 5, 1)).toBe(3);
  });

  test('長い一覧は、選んでいる行が見える範囲だけを出す', () => {
    expect(windowRange(0, 30, 10)).toEqual({ start: 0, end: 10 });
    expect(windowRange(15, 30, 10)).toEqual({ start: 10, end: 20 });
    expect(windowRange(29, 30, 10)).toEqual({ start: 20, end: 30 });
    expect(windowRange(1, 3, 10)).toEqual({ start: 0, end: 3 });
  });
});

describe('画面の描画', () => {
  test('選んでいる行に ▸ が付き、見えない件数と、操作の案内が出る', () => {
    const text = renderToString(
      <SelectView
        message="どこから取り込みますか?"
        items={items}
        index={12}
        columns={80}
        rows={20}
      />,
      { columns: 80 }
    );
    expect(text).toContain('どこから取り込みますか?');
    expect(text).toContain('▸ フォルダ12/');
    expect(text).toContain('↑ あと');
    expect(text).toContain('↓ あと');
    expect(text).toContain('Enter');
  });

  test('決めたあとは、1 行の記録になる', () => {
    const text = renderToString(
      <SelectView
        message="何をしますか?"
        items={items}
        index={2}
        columns={80}
        rows={20}
        answered
      />,
      { columns: 80 }
    );
    expect(text).toContain('✔');
    expect(text).toContain('フォルダ2/');
    expect(text).not.toContain('Enter');
  });

  test('入力欄は、入力の値(なければ、薄い初期値)を出す', () => {
    const empty = renderToString(
      <TextView
        message="場所"
        value=""
        initial="/Volumes/A/Pictures"
        columns={80}
      />,
      { columns: 80 }
    );
    expect(empty).toContain('/Volumes/A/Pictures');
    const typed = renderToString(
      <TextView
        message="場所"
        value="/x/y"
        initial="/Volumes/A"
        columns={80}
      />,
      { columns: 80 }
    );
    expect(typed).toContain('/x/y');
    expect(typed).not.toContain('/Volumes/A');
  });
});
