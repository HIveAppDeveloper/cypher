import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { GoogleLogin } from '../../components/GoogleLogin';
import { EmailLoginForm } from '../../components/EmailLoginForm';
import Image from 'next/image';

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
      <div className="login-orb login-orb-one" aria-hidden="true" />
      <div className="login-orb login-orb-two" aria-hidden="true" />
      <header className="login-brandbar">
        <a className="login-brand" href="/" aria-label="Cypher home">
          <span className="login-brand-mark" aria-hidden="true">
            <Image src="/cipher-logo.png" alt="" width={220} height={220} unoptimized />
          </span>
          <span>Cypher</span>
        </a>
        <span className="login-privacy-badge">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.4 16 5v4.2c0 3.8-2.5 6.7-6 8.4-3.5-1.7-6-4.6-6-8.4V5l6-2.6Z" /><path d="m7.3 9.9 1.8 1.8 3.7-4" /></svg>
          Your workspace
        </span>
      </header>

      <div className="login-layout">
        <section className="login-story" aria-label="Cypher workspace">
          <p className="login-kicker"><span />A CLEAR SPACE TO THINK</p>
          <h1>Make room<br /><span>for momentum.</span></h1>
          <p className="login-story-copy">Conversations, agents, and connected tools—together in one calm workspace.</p>
          <div className="login-story-note"><span aria-hidden="true" />Everything in its place. Ready when you are.</div>
        </section>

        <section className="login-card" aria-labelledby="login-title">
          <p className="login-eyebrow">WELCOME BACK</p>
          <h2 id="login-title">Sign in to Cypher</h2>
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
