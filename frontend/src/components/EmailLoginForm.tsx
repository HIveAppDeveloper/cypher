'use client';
import { FormEvent, useRef, useState } from 'react';

// Match the backend's per-address request window in app/api/auth.py.
const RESEND_INTERVAL_MS = 60_000;

export function EmailLoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const busy = useRef(false);
  async function requestLink() {
    if (busy.current) return;
    busy.current = true; setState('sending'); setError('');
    try {
      const response = await fetch('/api/auth/email/request', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Could not send a sign-in link. Please try again.');
      setSentAt(Date.now()); setState('sent');
    } catch (failure) {
      setState('idle'); setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : 'The sign-in request timed out. Check your connection and try again.');
    } finally { busy.current = false; }
  }
  function submit(event: FormEvent) { event.preventDefault(); void requestLink(); }
  return <form className="email-login-form" onSubmit={submit} aria-busy={state === 'sending'}>
    {state === 'sent' ? <div className="email-login-sent" role="status"><strong>Check your inbox</strong><p>A sign-in link was sent to <b>{email.trim()}</b>. Open it to continue. Check spam if it hasn’t arrived.</p><button type="button" className="login-skip" onClick={() => { setState('idle'); setError(''); }}>Use a different email</button><button type="button" className="btn-secondary" onClick={() => { const remaining = Math.ceil((RESEND_INTERVAL_MS - (Date.now() - sentAt)) / 1000); if(remaining > 0) { setError(`Wait ${remaining} seconds before requesting another link.`); return; } void requestLink(); }}>Resend link</button></div> : <><label htmlFor="workspace-email">Email address</label><input id="workspace-email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} required disabled={state === 'sending'} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" aria-describedby={error ? 'email-login-error' : undefined}/><button className="login-email-button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending sign-in link…' : 'Continue with email'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></>}
    {error ? <p id="email-login-error" className="login-error" role="alert">{error}</p> : null}
  </form>;
}
