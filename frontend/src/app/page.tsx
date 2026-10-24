import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import WorkspaceApp from '../components/WorkspaceApp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

// Keep the agent workspace as the default Cypher experience.
export default function Page() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
