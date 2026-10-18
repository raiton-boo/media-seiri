/** 本機の名前だけを受け付ける(DNS リバインディングで、ほかのサイトから読まれないようにする。要件 N-03) */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const hostnameOf = (host: string | null): string => {
  if (!host) return '';
  // `[::1]:3939` のような形は、角括弧までを名前とする
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0] ?? '';
};

/**
 * API・画面の、どちらのリクエストにも、かける制限。断るなら、その応答を返す(通すなら、undefined)。
 * - 本機の名前(127.0.0.1・localhost)以外の `Host` は、断る(403)
 * - 読み取り専用: GET・HEAD 以外は、断る(405)
 */
export const guardRequest = (request: Request): Response | undefined => {
  if (!LOCAL_HOSTS.has(hostnameOf(request.headers.get('host')))) {
    return new Response('本機からのみ接続できます', { status: 403 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('このビューアは、閲覧専用です', { status: 405 });
  }
  return undefined;
};
