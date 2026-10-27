import { FormEvent, useEffect, useRef, useState } from 'react';
import { dateFromApi } from '../lib/dates';
import { providerVerificationTarget } from '../lib/gateway-connections.mjs';

export type ModelConnection = {
  id: string; name: string; model: string; state: string; message: string;
  job_status?: string; checked_at?: string; verification_url?: string | null;
  account_url: string; can_add_api_key: boolean; key_configured?: boolean; requires_api_key?: boolean;
  verified_model?: string; access_kind?: 'account' | 'api_key' | 'public'; access_label?: string;
  verification_supported?: boolean; verification_target?: 'provider_account' | 'current_route';
  verification_scope?: 'provider_account' | 'current_route'; account_connected?: boolean;
};
const labels: Record<string, string> = {
  not_checked: 'Not checked', ready: 'Verified', checking: 'Checking',
  verification_required: 'Verification needed', sign_in_required: 'Sign-in needed',
  access_denied: 'Access denied', billing_required: 'Review billing',
  rate_limited: 'Rate limited', unavailable: 'Could not verify',
};
const connectionHelp: Record<string, string> = {
  openai: 'This checks the configured Codex gateway model route, not a ChatGPT account or subscription. Hosted ChatGPT sign-in still awaits approval.',
  gemini: 'Connect Gemini with an AI Studio API key. Google Workspace permissions and Google AI subscriptions are separate.',
  claude: 'Use a Claude Console API key for this app. Claude Pro and Max account sign-in is not offered here.',
  xai: 'Use an xAI API key. A Grok membership does not automatically grant API access.',
  meta: 'This checks the public Llama route. Meta Model API access, Facebook Pages and Instagram each require their own granted connection.',
};
function googleLink(value?: string | null) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null; } catch { return null; }
}

export function ModelConnections({ items, canManage, workerReady, onQueued, omniroute }: {
  items: ModelConnection[]; canManage: boolean; workerReady: boolean; onQueued: () => Promise<void>;
  omniroute: boolean; manageUrl?: string;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ provider: string; text: string } | null>(null);
  const [keyFor, setKeyFor] = useState('');
  const [key, setKey] = useState('');
  const busyRef = useRef(false);
  const mounted = useRef(false);
  const [queued, setQueued] = useState<Record<string, string | undefined>>({});
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setQueued(current => {
      const next = { ...current }; let changed = false;
      for (const [provider, checkedAt] of Object.entries(current)) {
        const item = items.find(item => item.id === provider);
        if (item && (item.state === 'checking' || item.checked_at !== checkedAt)) { delete next[provider]; changed = true; }
      }
      return changed ? next : current;
    });
  }, [items]);
  async function submit(provider: string, apiKey?: string, target: 'provider_account' | 'current_route' = providerVerificationTarget(provider)) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(provider); setError(null);
    // Keep keys out of drafts, URLs, browser storage and subsequent renders.
    if (apiKey !== undefined) { setKey(''); setKeyFor(''); }
    const requestedTarget = providerVerificationTarget(provider) === 'current_route' ? 'current_route' : target;
    try {
      const response = await fetch(`/api/runtime/model-connections/${encodeURIComponent(provider)}/${apiKey === undefined ? 'verify' : 'api-key'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(35000),
        body: JSON.stringify(apiKey === undefined ? { target: requestedTarget } : { api_key: apiKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The check could not start. Try again.');
      if (!['pending', 'running'].includes(data.status)) throw new Error('The server did not confirm a queued check. Refresh status before trying again.');
      if (apiKey === undefined && data.verification_target !== requestedTarget) throw new Error('The server did not confirm this type of check. Refresh status before trying again.');
      if (!mounted.current) return;
      setQueued(current => ({ ...current, [provider]: items.find(item => item.id === provider)?.checked_at }));
      try { await onQueued(); }
      catch { if (mounted.current) setError({ provider, text: 'The check is queued in the cloud, but its status could not refresh. Your check continues; reopen setup to see the result.' }); }
    } catch (failure) { if (mounted.current) setError({ provider, text: failure instanceof Error && failure.name !== 'AbortError' && failure.name !== 'TimeoutError' ? failure.message : 'Could not confirm whether the check was queued. Refresh status before trying again.' }); }
    finally { busyRef.current = false; if (mounted.current) setBusy(''); }
  }
  function saveKey(event: FormEvent, provider: string) {
    event.preventDefault();
    if (key.trim()) void submit(provider, key.trim());
  }
  return <section className="model-connections" aria-labelledby="model-connections-title">
    <h3 id="model-connections-title">Model access</h3>
    <p className="field-help">{omniroute ? 'Manage supported access here, then check the connected account. Subscription access, API keys and public model routes stay separate. Each check sends a short model request and can use provider quota.' : 'Check or add a provider connection for this workspace. Checks send a short model request and can use provider quota.'}</p>
    {!canManage ? <p className="field-help">The installation owner manages these shared provider connections.</p> : !items.length ? <p className="field-help" role="status">No provider connections are configured for this workspace.</p> : <ul className="model-connection-list">
      {items.map(item => {
        const locallyQueued = Object.hasOwn(queued, item.id);
        const checking = item.state === 'checking' || busy === item.id || locallyQueued;
        const verification = googleLink(item.verification_url);
        const checkedAt = dateFromApi(item.checked_at);
        return <li key={item.id} className="model-connection-row">
          <div className="model-connection-title"><strong>{item.name}</strong><span className="model-connection-status" data-state={item.state}>{checking ? locallyQueued || item.job_status === 'pending' ? 'Queued' : 'Checking…' : item.id === 'openai' && item.state === 'ready' ? 'Route available' : labels[item.state] || 'Not checked'}</span></div>
          <p className="field-help" role={checking ? 'status' : undefined}>{locallyQueued ? 'Queued in the cloud. You can close setup while the check runs.' : item.message}</p>
          {connectionHelp[item.id] ? <p className="field-help">{connectionHelp[item.id]}</p> : null}
          {item.verified_model ? <p className="model-connection-time">{item.id === 'openai' ? 'Gateway model route' : item.access_label || 'Model route'} · {item.verified_model}{item.access_kind === 'public' ? ' · Does not verify a subscription or provider account' : ''}</p> : null}
          {checkedAt ? <p className="model-connection-time">Last checked {checkedAt.toLocaleString()}</p> : null}
          <div className="model-connection-actions">
            {verification ? <a className="btn-primary" href={verification} target="_blank" rel="noopener noreferrer">Verify with Google</a> : null}
            {item.verification_supported === false ? <span className="field-help">Model verification is unavailable until provider setup is configured.</span> : !item.requires_api_key || item.key_configured ? <button className="btn-secondary" disabled={checking || !!busy || !workerReady} onClick={() => void submit(item.id, undefined, providerVerificationTarget(item.id))}>{checking ? locallyQueued || item.job_status === 'pending' ? 'Queued…' : 'Checking…' : item.id === 'openai' ? 'Test gateway route' : item.id === 'meta' ? 'Test Llama text route' : 'Check provider access'}</button> : <span className="field-help">Add an API key to connect</span>}
            {item.access_kind === 'public' && item.id !== 'meta' ? <button className="setup-doc-link" disabled={checking || !!busy || !workerReady} onClick={() => void submit(item.id, undefined, 'current_route')}>Test public route</button> : null}
            <a className="setup-doc-link" href={item.account_url} target="_blank" rel="noopener noreferrer">{item.id === 'meta' ? 'Meta Model API setup' : `Open ${item.name} account`}</a>
            {item.can_add_api_key ? <button className="setup-doc-link" disabled={checking || !!busy} onClick={() => { setKeyFor(keyFor === item.id ? '' : item.id); setKey(''); setError(null); }}>{item.key_configured ? 'Replace API key' : omniroute ? 'Add API fallback' : 'Use API key'}</button> : null}
          </div>
          {item.state === 'verification_required' ? <p className="field-help">Finish the account check on Google’s page, then return here and choose Check again. Opening the link does not mark the connection verified.</p> : null}
          {keyFor === item.id ? <form className="model-key-form" onSubmit={event => saveKey(event, item.id)}>
            <label htmlFor={`provider-key-${item.id}`}>{item.name} API key</label>
            <input id={`provider-key-${item.id}`} type="password" value={key} autoComplete="off" spellCheck={false} autoFocus onChange={event => setKey(event.target.value)} />
            <p className="field-help">{omniroute ? 'The key is sent over the protected cloud connection and encrypted there. It is saved only after a model response succeeds. Subscription access stays separate. Your current working key remains active if a replacement fails.' : 'The key is encrypted in the cloud and saved only after a model response succeeds. Your current working key stays saved if a replacement fails.'}</p>
            <div className="model-connection-actions"><button className="btn-secondary" type="submit" disabled={!key.trim() || !!busy || !workerReady}>Verify and save key</button><button type="button" className="setup-doc-link" onClick={() => { setKeyFor(''); setKey(''); }}>Cancel</button></div>
          </form> : null}
          {error?.provider === item.id ? <p role="alert" className="form-error">{error.text}</p> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
