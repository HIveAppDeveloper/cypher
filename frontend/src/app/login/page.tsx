import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { GoogleLogin } from '../../components/GoogleLogin';
import { EmailLoginForm } from '../../components/EmailLoginForm';

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
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title"><span className="login-mark" aria-hidden="true">G</span><h1 id="login-title">Welcome to GrokBot</h1><p className="login-copy">One workspace for your conversations, agents, and connected tools.</p><>{clientId ? <><GoogleLogin clientId={clientId} loginUri={loginUri}/><p className="login-divider">or continue with email</p></> : null}<EmailLoginForm/></>{error ? <p className="login-error" role="alert">{error}</p> : null}<p className="login-privacy">Sign in or create your private workspace. No password needed.</p></section></main>;
}
