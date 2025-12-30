import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Family Todo List',
  description: 'Self-hosted family todo list with voice input',
  manifest: '/manifest.json',
  themeColor: '#63b3ab',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Navbar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
