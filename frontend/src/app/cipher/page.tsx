import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cypher-mark.svg', apple: '/cypher-mark.svg' },
};

export default function CipherPage() {
  // Keep the legacy URL on the real Cypher-branded Open GrokBot workspace.
  redirect('/');
}
