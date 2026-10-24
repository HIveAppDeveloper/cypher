import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import ProspectingWorkspace from '../../components/ProspectingWorkspace';
import '../cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cypher Prospecting',
  description: 'Website-first company prospecting, powered by Open GrokBot.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

export default function ProspectingPage() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <ProspectingWorkspace/>;
}
