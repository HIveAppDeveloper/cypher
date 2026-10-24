import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cypher-favicon.png', apple: '/cypher-favicon.png' },
};

export default function CipherPage() {
  // Keep the legacy URL on the current branded workspace.
  redirect('/');
}
