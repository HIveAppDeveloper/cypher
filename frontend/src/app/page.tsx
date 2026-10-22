import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import WorkspaceApp from '../components/WorkspaceApp';

export const dynamic = 'force-dynamic';

export default function Page() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
