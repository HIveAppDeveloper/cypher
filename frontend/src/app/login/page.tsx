import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppSession, readSignedPayload } from '../../lib/auth-server';
import { EmailLoginForm } from '../../components/EmailLoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  let session: AppSession | null = null;
  try { session = readSignedPayload<AppSession>(cookies().get('grokbot_session')?.value); } catch { session = null; }
  if (session) redirect('/');
  const error = searchParams?.error === 'magic-link' ? 'That sign-in link is invalid or expired. Request a new one.' : null;
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title"><span className="login-mark" aria-hidden="true">G</span><p className="login-eyebrow">OPEN GROKBOT</p><h1 id="login-title">Your own AI workspace</h1><p className="login-copy">Create a private workspace for agents, chats, files, models, and connected tools.</p><EmailLoginForm/>{error ? <p className="login-error" role="alert">{error}</p> : null}<p className="login-privacy">Each email owns a separate workspace. No code or technical setup is required.</p></section></main>;
}
