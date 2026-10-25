import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { internalPathWithSearch } from '../../lib/canonical-app';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cypher-mark.svg', apple: '/cypher-mark.svg' },
};

export default async function CipherPage(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  // Keep the legacy URL on the real Cypher-branded Open GrokBot workspace.
  redirect(internalPathWithSearch('/', searchParams));
}
