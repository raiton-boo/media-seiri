import type { Metadata } from 'next';
import {
  Dela_Gothic_One,
  JetBrains_Mono,
  Noto_Sans_JP,
} from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '../components/Providers';
import './globals.css';

// 外部への通信は、背景地図のタイルだけ(要件 C-11)。フォントは、ビルド時に取り込んで、同梱する
const dela = Dela_Gothic_One({
  weight: '400',
  display: 'swap',
  preload: false,
  variable: '--font-dela',
});
const mono = JetBrains_Mono({
  weight: ['400', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-mono',
});
const noto = Noto_Sans_JP({
  weight: ['400', '700', '900'],
  display: 'swap',
  preload: false,
  variable: '--font-noto',
});

export const metadata: Metadata = {
  title: 'file-seiri',
  description: '整理したライブラリを、読むだけで見る',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${dela.variable} ${mono.variable} ${noto.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
