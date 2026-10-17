import type { NextConfig } from 'next';

// 画面を静的ファイルに書き出す(単体の実行ファイルに同梱して配るため)
const nextConfig: NextConfig = { output: 'export' };

export default nextConfig;
