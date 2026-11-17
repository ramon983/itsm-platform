import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';

import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AdminZero',
  description: 'Human-centric ITSM — 50/50 AI + human.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
  ],
};

// Applies the saved theme before first paint (no flash of the wrong theme).
const THEME_BOOT = `try{var p=(JSON.parse(localStorage.getItem('adminzero-platform-v3')||'{}').state||{}).themePreference||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="bg-canvas text-slate-100">{children}</body>
    </html>
  );
}
