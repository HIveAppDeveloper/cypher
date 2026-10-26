import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../../lib/auth-server';
import { CANONICAL_APP_ORIGIN, isOffCanonicalHost, requestHostname, safeInternalReturnTo } from '../../../lib/canonical-app';
import { ProviderConsentResult } from '../../../components/ProviderConsent';
export const dynamic = 'force-dynamic';

export default async function ProviderReturnPage(props: { searchParams?: Promise<Record<string,string|string[]|undefined>> }) {
  const query = await props.searchParams;
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch {}
  if (isOffCanonicalHost(requestHostname(await headers()))) redirect(new URL('/connect/models',CANONICAL_APP_ORIGIN).toString());
  if (!session) redirect('/login?returnTo=%2Fconnect%2Fmodels');
  const value = typeof query?.flow === 'string' ? query.flow : '';
  const flowId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : '';
  const back = typeof query?.returnTo === 'string' ? safeInternalReturnTo(query.returnTo) : null;
  return <ProviderConsentResult flowId={flowId} result={typeof query?.result==='string'?query.result:''} returnTo={back && !back.startsWith('/api/')?back:'/'} />;
}
