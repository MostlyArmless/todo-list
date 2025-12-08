import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Family Todo List',
  description: 'Self-hosted family todo list with voice input',
  manifest: '/manifest.json',
  themeColor: '#e94560',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
