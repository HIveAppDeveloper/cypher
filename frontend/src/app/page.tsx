import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import ProspectingWorkspace from '../components/ProspectingWorkspace';
import './cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Research real companies from your website, with public evidence.',
  icons: { icon: '/cipher-logo.png', shortcut: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

// Keep the preferred website-first Cypher flow at the main entry point.
export default function Page() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login');
  return <ProspectingWorkspace />;
}
