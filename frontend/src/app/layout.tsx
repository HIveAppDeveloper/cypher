import '@fontsource-variable/inter';
import './globals.css';
import './workspace-ux.css';
import './grok-workspace.css';
import './apple-native.css';
import './cypher-refined.css';
import './cipher/cipher.css';
import './cypher-brand.css';
import './cypher-conversation.css';
import './cypher-motion.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
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
