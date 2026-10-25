import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../../lib/auth-server';
import VcProspectingWorkspace from '../../../components/VcProspectingWorkspace';
import '../../cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VC Intelligence · Cypher',
  description: 'Search public SEC founder leads and match investment theses with Cypher.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

export default async function VcProspectingPage() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <VcProspectingWorkspace accountId={session?.sub} />;
}
