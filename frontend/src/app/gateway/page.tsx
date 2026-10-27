import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { publicGatewayManagementUrl } from '../../lib/gateway-dashboard.mjs';
import GatewayDashboard from '../../components/GatewayDashboard';
import './gateway.css';
import './connections.css';
import { loginReadiness } from '../../lib/login-readiness.mjs';
import { requestHostname } from '../../lib/canonical-app';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title:'Cypher · AI gateway',description:'Your existing models, provider connections, and gateway usage in one place.'};

export default async function GatewayPage() {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) redirect('/login?returnTo=%2Fgateway');
  // Only the verified public dashboard origin can enter the client bundle. Never pass
  // the raw runtime URL, private bindings, credentials, or protection-bypass headers.
  const manageUrl = publicGatewayManagementUrl(process.env.OMNIROUTE_DASHBOARD_URL || process.env.OMNIROUTE_URL);
  const hostname=requestHostname(await headers());
  const readiness=loginReadiness({local:hostname==='localhost'||hostname==='127.0.0.1',requireAuth:process.env.REQUIRE_USER_AUTH,backendConfigured:!!(process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL),backendTokenLength:(process.env.GROKBOT_BACKEND_API_TOKEN||process.env.BACKEND_API_TOKEN||'').length,sessionSecretLength:(process.env.AUTH_SESSION_SECRET||'').length});
  return <GatewayDashboard key={session?.sub ?? 'local'} accountId={session?.sub} approvedManageUrl={manageUrl} preview={readiness.preview}/>;
}
