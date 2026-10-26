import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { CANONICAL_APP_ORIGIN, isOffCanonicalHost, requestHostname, safeInternalReturnTo } from '../../lib/canonical-app';
import { GoogleLogin } from '../../components/GoogleLogin';
import { EmailLoginForm } from '../../components/EmailLoginForm';
import CypherMark from '../../components/cipher/CypherMark';
import CypherEntrance from '../../components/cipher/CypherEntrance';
import { loginReadiness, previewDestination } from '../../lib/login-readiness.mjs';

export const dynamic = 'force-dynamic';

export default async function LoginPage(props: { searchParams?: Promise<{ error?: string; returnTo?: string }> }) {
  const searchParams = await props.searchParams;
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>((await cookies()).get('grokbot_session')?.value); } catch { session = null; }
  const returnTo = safeInternalReturnTo(searchParams?.returnTo);
  const host = requestHostname(await headers());
  const local = host === 'localhost' || host === '127.0.0.1';
  const origin = local ? process.env.GROKBOT_PUBLIC_URL || 'http://localhost:3000' : CANONICAL_APP_ORIGIN;
  if (!local && isOffCanonicalHost(host)) {
    const destination = new URL(session ? returnTo || '/' : '/login', origin);
    if (!session && searchParams?.error) destination.searchParams.set('error', searchParams.error);
    if (!session && returnTo) destination.searchParams.set('returnTo', returnTo);
    redirect(destination.toString());
  }
  if (session) redirect(returnTo || '/');
  const readiness=loginReadiness({local,requireAuth:process.env.REQUIRE_USER_AUTH,backendConfigured:!!(process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL),backendTokenLength:(process.env.GROKBOT_BACKEND_API_TOKEN||process.env.BACKEND_API_TOKEN||'').length,sessionSecretLength:(process.env.AUTH_SESSION_SECRET||'').length});
  const errors: Record<string, string> = {
    'magic-link': 'That sign-in link is invalid or expired. Request a new one.',
    google: 'Google could not complete sign-in. Try again or use email below.',
    'google-csrf': 'This sign-in expired. Start again from this page.',
    unavailable: 'The sign-in service is temporarily unavailable. Try again shortly.',
    'email-required': 'Use an email sign-in link to access your existing workspace.',
  };
  const error = errors[searchParams?.error || ''];
  const clientId = process.env.GOOGLE_AUTH_CLIENT_ID || process.env.HIVE_GOOGLE_AUTH_CLIENT_ID;
  const loginUri = new URL('/api/auth/google/callback', origin);
  if (returnTo) loginUri.searchParams.set('returnTo', returnTo);
  return (
    <main className="login-page">
      {!readiness.preview ? <CypherEntrance /> : null}
      <header className="login-brandbar"><a className="login-brand" href="/" aria-label="Cypher home"><CypherMark className="brand-symbol" decorative/><span>Cypher</span></a></header>

      <div className="login-layout">
        <section className="login-card" aria-labelledby="login-title">
          <CypherMark className="login-hero-mark" decorative />
          <h1 id="login-title">{readiness.preview ? 'Gateway preview' : 'Sign in'}</h1>
          <p className="login-copy">{readiness.preview ? 'Explore the gateway. No sign-in needed.' : 'Pick up where you left off.'}</p>
          {readiness.configured && clientId ? <>
            <GoogleLogin clientId={clientId} loginUri={loginUri.toString()} />
            <div className="login-divider"><span>or use your email</span></div>
          </> : null}
          {readiness.preview ? <>
            <a className="login-email-button" href={previewDestination(returnTo)}>Open gateway preview<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
            <p className="login-privacy">This local preview uses sample data. Real account connections and sign-in are available in the cloud app.</p>
            <a className="login-skip" href={CANONICAL_APP_ORIGIN+'/login'}>Open the cloud app</a>
          </> : readiness.configured ? <>
            <EmailLoginForm returnTo={returnTo || undefined} />
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <p className="login-privacy">Sign in or create your workspace with a secure email link. No password needed.</p>
          </> : <>
            <p className="login-error" role="alert">Sign-in is temporarily unavailable. No email has been sent.</p>
            <a className="login-email-button" href={returnTo?'/login?returnTo='+encodeURIComponent(returnTo):'/login'}>Try again</a>
          </>}
        </section>
      </div>
    </main>
  );
}
