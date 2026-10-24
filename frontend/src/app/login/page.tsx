import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { GoogleLogin } from '../../components/GoogleLogin';
import { EmailLoginForm } from '../../components/EmailLoginForm';
import CypherMark from '../../components/cipher/CypherMark';
import CypherEntrance from '../../components/cipher/CypherEntrance';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (session) redirect('/');
  const errors: Record<string, string> = {
    'magic-link': 'That sign-in link is invalid or expired. Request a new one.',
    google: 'Google could not complete sign-in. Try again or use email below.',
    'google-csrf': 'This sign-in expired. Start again from this page.',
    unavailable: 'The sign-in service is temporarily unavailable. Try again shortly.',
    'email-required': 'Use an email sign-in link to access your existing workspace.',
  };
  const error = errors[searchParams?.error || ''];
  const clientId = process.env.GOOGLE_AUTH_CLIENT_ID || process.env.HIVE_GOOGLE_AUTH_CLIENT_ID;
  const loginUri = (process.env.GROKBOT_PUBLIC_URL || 'http://localhost:3000') + '/api/auth/google/callback';
  return (
    <main className="login-page">
      <CypherEntrance />
      <header className="login-brandbar"><a className="login-brand" href="/" aria-label="Cypher home"><CypherMark className="brand-symbol" decorative/><span>Cypher</span></a></header>

      <div className="login-layout">
        <section className="login-card" aria-labelledby="login-title">
          <CypherMark className="login-hero-mark" decorative />
          <h1 id="login-title">Sign in</h1>
          <p className="login-copy">Pick up where you left off.</p>
          {clientId ? <>
            <GoogleLogin clientId={clientId} loginUri={loginUri} />
            <div className="login-divider"><span>or use your email</span></div>
          </> : null}
          <EmailLoginForm />
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <p className="login-privacy">Sign in or create your workspace with a secure email link. No password needed.</p>
        </section>
      </div>
    </main>
  );
}
