import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';

import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AdminZero · Swarm Dashboard',
  description: 'Human-centric ITSM, SaaS governance, ITAM and JIT vault — agent workspace.',
};

export const viewport: Viewport = { themeColor: '#090D16' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} antialiased`}>
      <body className="bg-[#090D16] text-slate-100">{children}</body>
    </html>
  );
}
