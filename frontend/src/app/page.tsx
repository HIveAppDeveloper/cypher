import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import WorkspaceApp from '../components/WorkspaceApp';
import TerritoryPulse from '../components/TerritoryPulse';

export const dynamic = 'force-dynamic';

export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  const useWorkspace = searchParams?.workspace === '1' || searchParams?.conversation !== undefined || searchParams?.plugins !== undefined;
  return useWorkspace ? <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/> : <TerritoryPulse/>;
}
