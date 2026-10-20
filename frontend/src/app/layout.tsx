import '@fontsource-variable/inter';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Open GrokBot',
  description: 'Open-source, self-hosted alternative to Grok Bot',
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
