import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import WorkspaceApp from '../components/WorkspaceApp';
import './cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cipher',
  description: 'Find the right buyer and act first: one-button prospecting and outbound.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

// Keep the Cipher identity while sending the home page through Open GrokBot's
// authenticated workspace and real agent/backend capabilities.
export default function Page() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
