import { describe, expect, test } from 'bun:test';
import { displayWidth, formatTable, padEndDisplay } from './table.ts';

describe('表示の幅', () => {
  test('全角は 2、半角は 1', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('写真')).toBe(4);
    expect(displayWidth('写真 1')).toBe(6);
    expect(displayWidth('')).toBe(0);
    expect(padEndDisplay('写真', 6)).toBe('写真  ');
    expect(padEndDisplay('abcdef', 3)).toBe('abcdef');
  });

  test('日本語を含む表でも、列がそろう(最後の列は、そろえない)', () => {
    const lines = formatTable(
      ['名前', '容量', '備考'],
      [
        ['写真用', '2.0 TB', 'a'],
        ['USB', '15.5 GB', 'bb'],
      ]
    );
    expect(lines).toEqual([
      '名前    容量     備考',
      '写真用  2.0 TB   a',
      'USB     15.5 GB  bb',
    ]);
    // 2 列目の開始位置が、すべての行で同じ(表示の幅で)
    const starts = lines.map((line) =>
      displayWidth(line.slice(0, line.search(/\d|容/)))
    );
    expect(new Set(starts).size).toBe(1);
  });

  test('行がなくても、ヘッダーだけ出る', () => {
    expect(formatTable(['a', 'b'], [])).toEqual(['a  b']);
  });
});
