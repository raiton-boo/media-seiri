import type { NextConfig } from 'next';

// 画面は、静的ファイルに書き出す(`out/`)。Hono が配信し、単体の実行ファイルに同梱する(tech-selection §3-1)
const nextConfig: NextConfig = { output: 'export' };

export default nextConfig;
