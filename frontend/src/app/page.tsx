import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import { internalPathWithSearch } from '../lib/canonical-app';
import WorkspaceApp from '../components/WorkspaceApp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cypher-favicon.png', apple: '/cypher-favicon.png' },
};

// Keep the agent workspace as the default Cypher experience.
export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) {
    const returnTo = internalPathWithSearch('/', searchParams);
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
