import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import WorkspaceApp from '../components/WorkspaceApp';
import CipherApp from '../components/cipher/CipherApp';
import './cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cipher — Territory Pulse',
  description: 'Find the right buyer and act first: one-button prospecting and outbound.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

// The home page opens Cipher. The agent workspace is at /?workspace=1, and its
// conversation (?conversation=) and plugin-callback (?plugins=) links still open it.
export default function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  const workspace = searchParams?.workspace === '1' || searchParams?.conversation !== undefined || searchParams?.plugins !== undefined;
  return workspace ? <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/> : <CipherApp/>;
}
