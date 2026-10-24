import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import WorkspaceApp from '../../components/WorkspaceApp';
import '../cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cypher Workspace',
  description: 'Open GrokBot agents, conversations, and connected tools.',
  icons: { icon: '/cypher-mark.svg', apple: '/cypher-mark.svg' },
};

export default function WorkspacePage() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
