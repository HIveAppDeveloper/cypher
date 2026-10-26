'use client';
import { useEffect, useRef, useState } from 'react';
import CypherMark from './cipher/CypherMark';
import { CANONICAL_APP_ORIGIN, safeInternalReturnTo } from '../lib/canonical-app';

export function ProviderConsentButton({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function connect() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch('/api/model-connections/openrouter/begin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({returnTo:window.location.pathname+window.location.search}),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string'?data.detail:'The account connection could not start.');
      const url = new URL(data.authorization_url);
      if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/auth' || url.username || url.password || url.searchParams.get('callback_url') !== CANONICAL_APP_ORIGIN+'/api/model-connections/openrouter/callback' || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') || '') || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') || ''))
        throw new Error('The provider returned an unexpected sign-in address.');
      if (mounted.current) window.location.assign(url.href);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error && failure.name !== 'AbortError' ? failure.message : 'The connection could not start. Your existing providers are unchanged.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div><button type="button" className="btn-secondary" disabled={disabled || busy} onClick={() => void connect()}>{busy?'Opening OpenRouter…':'Connect OpenRouter'}</button>{error?<p role="alert" className="form-error">{error}</p>:null}</div>;
}

export function ProviderConsentResult({ flowId, result, returnTo }: { flowId: string; result: string; returnTo: string }) {
  const [state, setState] = useState(['failed','cancelled','sign_in_required'].includes(result)?result:flowId?'saving':'failed');
  const [message, setMessage] = useState('Checking the secure account handoff. No model request runs.');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!flowId || ['failed','cancelled','sign_in_required'].includes(result)) return;
    let active = true; let pending = false; let terminal = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(); const deadline = Date.now()+600000;
    async function poll() {
      if (!active || terminal || pending || document.hidden) return;
      clearTimeout(timer); pending = true;
      try {
        const response = await fetch('/api/model-connections/openrouter/status?flow='+encodeURIComponent(flowId), {cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        const data = await response.json();
        if ([401,403,404].includes(response.status)) { if (active) { terminal = true; setState(response.status===401?'sign_in_required':'failed'); setError('This account connection is unavailable. Sign in as the installation owner and start again.'); } return; }
        if (!response.ok) throw new Error('Could not refresh account status. The cloud check continues.');
        if (!active) return;
        if (data.status === 'connected' && data.account_connected === true && data.model_access_verified === false) {
          terminal = true; setState('connected'); setMessage('OpenRouter account connected. Model access has not been tested.'); setError(''); return;
        }
        if (['failed','expired','cancelled','superseded'].includes(data.status)) { terminal = true; setState(data.status); setError('This connection was not completed. Your previous providers are unchanged.'); return; }
        if (!['awaiting','exchanging','saving'].includes(data.status)) throw new Error('Account status could not be verified.');
        setState('saving'); setMessage('Consent received. The cloud is checking and saving the account; no model inference runs.'); setError('');
      } catch (failure) { if (active) setError(failure instanceof Error?failure.message:'Could not refresh account status.'); }
      finally { pending = false; }
      if (active && Date.now() < deadline) timer = setTimeout(poll,3000);
      else if (active) setError('The check is taking longer. Your cloud check continues; reopen model access later.');
    }
    const resume = () => { if (!document.hidden) void poll(); };
    window.addEventListener('focus',resume); document.addEventListener('visibilitychange',resume); void poll();
    return () => { active = false; controller.abort(); clearTimeout(timer); window.removeEventListener('focus',resume); document.removeEventListener('visibilitychange',resume); };
  }, [flowId,result]);
  const candidate = safeInternalReturnTo(returnTo);
  const back = candidate && !/^\/(?:api|login|connect)(?:\/|\?|$)/.test(candidate) ? candidate : '/';
  const failed = ['failed','expired','cancelled','superseded','sign_in_required'].includes(state);
  return <main className="google-permissions-page"><a className="google-permissions-brand" href="/" aria-label="Cypher home"><CypherMark decorative/><span>Cypher</span></a><section className="google-permissions-content" aria-labelledby="provider-consent-title">
    <h1 id="provider-consent-title">{state==='connected'?'Account connected':failed?'Account connection not completed':'Finishing account connection'}</h1>
    <p role="status">{failed?'Your previous provider connections are unchanged. Return to model access to try again.':message}</p>
    <p>OpenRouter uses separate credits. This does not transfer your Google, OpenAI, Anthropic, Meta or Grok subscriptions.</p>
    {error?<p role="alert" className="google-permissions-error">{error}</p>:null}
    <div className="google-permissions-actions"><a className="btn-primary" href={state==='sign_in_required'?'/login':back}>{state==='sign_in_required'?'Sign in to Cypher':'Continue to workspace'}</a></div>
  </section></main>;
}
