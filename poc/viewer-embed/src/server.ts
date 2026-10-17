import { Hono } from 'hono';
import { assets } from './assets';

// 外部に公開しないため、本機からの接続だけを受け付ける
const HOST = '127.0.0.1';
const PORT = 3939;

const app = new Hono();

app.get('/api/hello', (context) =>
  context.json({ message: 'hello from hono', time: new Date().toISOString() })
);

// 静的書き出しは「/about」をabout.htmlとして出力するため、拡張子の有無の両方を探す
app.get('*', (context) => {
  const pathname = new URL(context.req.url).pathname;
  const candidates = [
    pathname,
    `${pathname}.html`,
    `${pathname.replace(/\/$/, '')}/index.html`,
  ];
  const filePath = candidates
    .map((candidate) => assets[candidate])
    .find((path) => path !== undefined);
  if (!filePath) return context.notFound();
  return new Response(Bun.file(filePath));
});

Bun.serve({ port: PORT, hostname: HOST, fetch: app.fetch });
console.log(`http://${HOST}:${PORT}/`);
