/**
 * 単一の実行ファイルに埋め込んだ、画面(静的書き出し)の一覧。パス(`/errors.html` など)→ 読めるファイルの場所。
 * 埋め込んでいなければ(開発のとき)、ディスクの `web/out/` を使う。
 */
let embedded: ReadonlyMap<string, string> | undefined;

export const setEmbeddedWeb = (
  files: Readonly<Record<string, string>> | undefined
): void => {
  embedded = files ? new Map(Object.entries(files)) : undefined;
};

export const embeddedWeb = (): ReadonlyMap<string, string> | undefined =>
  embedded;
