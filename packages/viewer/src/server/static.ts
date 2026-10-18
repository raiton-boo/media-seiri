import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/**
 * Next.js の静的書き出し(`web/out/`)を配信する関数を返す。見つからなければ、undefined。
 * 書き出しは、`/errors` を `errors.html` として出すため、拡張子の有無の両方を探す。
 */
export const staticFiles = (
  webDir: string
): ((pathname: string) => Response | undefined) => {
  const root = normalize(webDir);
  return (pathname) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return undefined;
    }
    const clean = decoded.replace(/\/+$/, '');
    for (const candidate of [clean, `${clean}.html`, `${clean}/index.html`]) {
      const path = normalize(join(root, candidate));
      // 配信の置き場の外(`..` など)は、読ませない
      if (path !== root && !path.startsWith(root + sep)) continue;
      if (existsSync(path) && statSync(path).isFile()) {
        return new Response(Bun.file(path));
      }
    }
    return undefined;
  };
};
