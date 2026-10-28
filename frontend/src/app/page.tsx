import { cookies } from 'next/headers';
import { AppSession, readSignedPayload } from '../lib/auth-server';
import { internalPathWithSearch } from '../lib/canonical-app';
import WorkspaceApp from '../components/WorkspaceApp';
import PublicDocument from '../components/PublicDocument';
import {publicMetadata} from '../lib/public-metadata';

export const dynamic = 'force-dynamic';

export const metadata = publicMetadata('/');

// Keep the agent workspace as the default Cypher experience.
export default async function Page(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) {
    const returnTo = internalPathWithSearch('/', searchParams);
    return <PublicDocument path="/" loginHref={`/login?returnTo=${encodeURIComponent(returnTo)}`}/>;
  }
  return <WorkspaceApp accountEmail={session?.email} accountId={session?.sub}/>;
}
