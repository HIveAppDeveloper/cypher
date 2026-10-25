'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';

// Match the backend's per-address request window in app/api/auth.py.
const RESEND_INTERVAL_MS = 60_000;

export function EmailLoginForm({ returnTo }: { returnTo?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [resendAvailable, setResendAvailable] = useState(false);
  const [resending, setResending] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (state !== 'sent') return;
    const remaining = RESEND_INTERVAL_MS - (Date.now() - sentAt);
    if (remaining <= 0) { setResendAvailable(true); return; }
    setResendAvailable(false);
    const timer = setTimeout(() => setResendAvailable(true), remaining);
    return () => clearTimeout(timer);
  }, [state, sentAt]);

  async function requestLink(resend = false) {
    if (busy.current) return;
    busy.current = true;
    if (resend) setResending(true); else setState('sending');
    setError('');
    try {
      const response = await fetch('/api/auth/email/request', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), return_to: returnTo }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Could not send a sign-in link. Please try again.');
      setSentAt(Date.now()); setResendAvailable(false); setState('sent');
    } catch (failure) {
      if (!resend) setState('idle');
      setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'The sign-in request timed out. Check your connection and try again.');
    } finally { busy.current = false; setResending(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void requestLink(); }
  return <form className="email-login-form" onSubmit={submit} aria-busy={state === 'sending' || resending}>
    {state === 'sent' ? <div className="email-login-sent" role="status">
      <strong>Check your inbox</strong>
      <p>A sign-in link was sent to <b>{email.trim()}</b>. Open it to continue. Check spam if it hasn’t arrived.</p>
      <button type="button" className="login-skip" disabled={resending} onClick={() => { if (busy.current) return; setState('idle'); setError(''); }}>Use a different email</button>
      <p className="email-login-resend-note">For your security, sign-in links can be requested once a minute.</p>
      <button type="button" className="btn-secondary" disabled={!resendAvailable || resending} onClick={() => void requestLink(true)}>
        {resending ? 'Sending new link…' : 'Resend link'}
      </button>
    </div> : <>
      <label htmlFor="workspace-email">Email address</label>
      <input id="workspace-email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required disabled={state === 'sending'} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-describedby={error ? 'email-login-error' : undefined}/>
      <button className="login-email-button" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending sign-in link…' : 'Continue with email'}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
      </button>
    </>}
    {error ? <p id="email-login-error" className="login-error" role="alert">{error}</p> : null}
  </form>;
}
