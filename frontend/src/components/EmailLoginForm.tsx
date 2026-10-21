'use client';

import { FormEvent, useState } from 'react';

export function EmailLoginForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setState('sending'); setError('');
    try {
      const response = await fetch('/api/auth/email/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : 'Could not send a sign-in link.');
      setState('sent');
    } catch (failure) { setState('idle'); setError(failure instanceof Error ? failure.message : 'Could not send a sign-in link.'); }
  }
  if (state === 'sent') return <div className="email-login-sent" role="status"><strong>Check your email</strong><p>We sent a one-time link. Click it to open your private workspace. No code or password is required.</p><button type="button" className="login-skip" onClick={() => setState('idle')}>Use another email</button></div>;
  return <form className="email-login-form" onSubmit={submit}><label htmlFor="workspace-email">Email address</label><input id="workspace-email" name="email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/><button className="login-email-button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Continue with email'}</button>{error ? <p className="login-error" role="alert">{error}</p> : null}</form>;
}
