import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { internalPathWithSearch } from '../../lib/canonical-app';
import WorkspaceApp from '../../components/WorkspaceApp';
import '../cipher/cipher.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Cypher Workspace',
  description: 'Your workspace for Cypher conversations, agents, and connected tools.',
  icons: { icon: '/cypher-mark.svg', apple: '/cypher-mark.svg' },
};

export default async function WorkspacePage(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) {
    const returnTo = internalPathWithSearch('/workspace', searchParams);
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
