// テストの前に、1 回だけ動かす(bunfig.toml の `[test] preload`)。
// 端末で `bun run test` を動かしても、パイプで動かしても、同じ結果になるよう、「端末ではない・色なし」に固定する。
// (端末だと、色の制御文字が結果に混ざったり、Enter 待ちで止まったりして、端末のときだけ、失敗していた)
process.env.NO_COLOR = '1';
delete process.env.COLORTERM;
for (const stream of [process.stdin, process.stdout, process.stderr]) {
  Object.defineProperty(stream, 'isTTY', { value: false, configurable: true });
}
// 端末の幅は、決まった値に(端末によって、枠の折り返しが変わらないように)
Object.defineProperty(process.stdout, 'columns', {
  value: 100,
  configurable: true,
});
Object.defineProperty(process.stdout, 'rows', {
  value: 40,
  configurable: true,
});
