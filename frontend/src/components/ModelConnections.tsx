import { FormEvent, useState } from 'react';

export type ModelConnection = {
  id: string; name: string; model: string; state: string; message: string;
  job_status?: string; checked_at?: string; verification_url?: string | null;
  account_url: string; can_add_api_key: boolean; key_configured?: boolean; requires_api_key?: boolean;
};
const labels: Record<string, string> = {
  not_checked: 'Not checked', ready: 'Verified', checking: 'Checking',
  verification_required: 'Verification needed', sign_in_required: 'Sign-in needed',
  access_denied: 'Access denied', billing_required: 'Review billing',
  rate_limited: 'Rate limited', unavailable: 'Could not verify',
};
function googleLink(value?: string | null) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null; } catch { return null; }
}

export function ModelConnections({ items, canManage, workerReady, onQueued, omniroute, manageUrl }: {
  items: ModelConnection[]; canManage: boolean; workerReady: boolean; onQueued: () => Promise<void>;
  omniroute: boolean; manageUrl?: string;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<{ provider: string; text: string } | null>(null);
  const [keyFor, setKeyFor] = useState('');
  const [key, setKey] = useState('');
  async function submit(provider: string, apiKey?: string) {
    if (busy) return;
    setBusy(provider); setError(null);
    // Keep keys out of drafts, URLs, browser storage and subsequent renders.
    if (apiKey !== undefined) { setKey(''); setKeyFor(''); }
    try {
      const response = await fetch(`/api/runtime/model-connections/${provider}/${apiKey === undefined ? 'verify' : 'api-key'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        ...(apiKey === undefined ? {} : { body: JSON.stringify({ api_key: apiKey }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The check could not start. Try again.');
      await onQueued();
    } catch (failure) { setError({ provider, text: failure instanceof Error ? failure.message : 'The check could not start. Try again.' }); }
    finally { setBusy(''); }
  }
  function saveKey(event: FormEvent, provider: string) {
    event.preventDefault();
    if (key.trim()) void submit(provider, key.trim());
  }
  const safeManageUrl = (() => {
    try {
      const url = new URL(manageUrl || '');
      return (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  })();
  return <section className="model-connections" aria-labelledby="model-connections-title">
    <h3 id="model-connections-title">Model access</h3>
    <p className="field-help">{omniroute ? 'Cypher sends model requests through OmniRoute. Connect eligible accounts in OmniRoute, then check them here. Provider sign-ins stay in OmniRoute; Cypher uses its existing gateway key. Checks send a short model request.' : 'Check or add a provider connection for this workspace. Checks send a short model request.'}</p>
    {omniroute && canManage && safeManageUrl ? <p className="field-help"><a className="setup-doc-link" href={safeManageUrl} target="_blank" rel="noopener noreferrer">Connect accounts in OmniRoute</a></p> : null}
    {!canManage ? <p className="field-help">The installation owner manages these shared provider connections.</p> : <ul className="model-connection-list">
      {items.map(item => {
        const checking = item.state === 'checking' || busy === item.id;
        const verification = googleLink(item.verification_url);
        return <li key={item.id} className="model-connection-row">
          <div className="model-connection-title"><strong>{item.name}</strong><span className="model-connection-status" data-state={item.state}>{checking ? item.job_status === 'pending' ? 'Queued' : 'Checking…' : labels[item.state] || 'Not checked'}</span></div>
          <p className="field-help" role={checking ? 'status' : undefined}>{item.message}</p>
          {item.checked_at ? <p className="model-connection-time">Last checked {new Date(item.checked_at).toLocaleString()}</p> : null}
          <div className="model-connection-actions">
            {verification ? <a className="btn-primary" href={verification} target="_blank" rel="noopener noreferrer">Verify with Google</a> : null}
            {!item.requires_api_key || item.key_configured ? <button className="btn-secondary" disabled={checking || !!busy || !workerReady} onClick={() => void submit(item.id)}>{checking ? 'Checking…' : item.state === 'not_checked' ? 'Check access' : 'Check again'}</button> : <span className="field-help">Add an API key to connect</span>}
            {!omniroute || keyFor === item.id ? <a className="setup-doc-link" href={item.account_url} target="_blank" rel="noopener noreferrer">Open {item.name} account</a> : null}
            {item.can_add_api_key ? <button className="setup-doc-link" disabled={checking || !!busy} onClick={() => { setKeyFor(keyFor === item.id ? '' : item.id); setKey(''); setError(null); }}>{item.key_configured ? 'Replace API key' : omniroute ? 'Add API fallback' : 'Use API key'}</button> : null}
          </div>
          {item.state === 'verification_required' ? <p className="field-help">Finish the account check on Google’s page, then return here and choose Check again. Opening the link does not mark the connection verified.</p> : null}
          {keyFor === item.id ? <form className="model-key-form" onSubmit={event => saveKey(event, item.id)}>
            <label htmlFor={`provider-key-${item.id}`}>{item.name} API key</label>
            <input id={`provider-key-${item.id}`} type="password" value={key} autoComplete="off" spellCheck={false} autoFocus onChange={event => setKey(event.target.value)} />
            <p className="field-help">{omniroute ? 'The key is sent to OmniRoute over the protected connection and encrypted there. It is saved only after a model response succeeds. Subscription access stays separate. Your current working key remains active if a replacement fails.' : 'The key is encrypted in the cloud and saved only after a model response succeeds. Your current working key stays saved if a replacement fails.'}</p>
            <div className="model-connection-actions"><button className="btn-secondary" type="submit" disabled={!key.trim() || !!busy || !workerReady}>{omniroute ? 'Verify and add to OmniRoute' : 'Verify and save key'}</button><button type="button" className="setup-doc-link" onClick={() => { setKeyFor(''); setKey(''); }}>Cancel</button></div>
          </form> : null}
          {error?.provider === item.id ? <p role="alert" className="form-error">{error.text}</p> : null}
        </li>;
      })}
    </ul>}
  </section>;
}
