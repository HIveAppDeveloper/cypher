import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cipher-logo.png', shortcut: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

export default function CipherPage() {
  // Keep the legacy URL on the real Cypher-branded Open GrokBot workspace.
  redirect('/');
}
