import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { approveConnection } from '../lib/device';
import type { PluginConnection } from './PluginPanel';

export function AtlasConnectionSetup({ onConnected }: { onConnected: (connection: PluginConnection, message: string) => void }) {
  const [name, setName] = useState('Atlas · Hive');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (!key.trim().startsWith('atlas_sk_')) throw new Error('Paste the workspace API key from Atlas. It starts with atlas_sk_.');
      const url = 'https://atlassolution.net/api/mcp';
      const approval_id = await approveConnection('connect_plugin:' + url);
      const connection = await api.connectPlugin({ name: name.trim(), url, token: key.trim(), approval_id, new_connection: true });
      setKey('');
      let message = `${connection.name} saved. Your other accounts are still connected.`;
      try {
        const result = await api.testPlugin(connection.id);
        message += result.status === 'passed' ? ' Atlas workspace access verified.' : ` ${result.message}`;
      } catch {
        message += ' Tool discovery succeeded, but workspace verification could not finish. Use Test tools to retry.';
      }
      onConnected(connection, message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not connect. Check the workspace key and try again.');
    } finally { setBusy(false); }
  }

  return <form className="connector-custom" onSubmit={event => void connect(event)}>
    <h3>Connect Atlas / Hive</h3>
    <p>Choose the Atlas workspace that has Hive access. Each workspace gets its own connection here.</p>
    <ol>
      <li><a href="https://atlassolution.net/app" target="_blank" rel="noreferrer">Open Atlas</a> and select the Hive workspace.</li>
      <li>Open <strong>Team → API keys</strong>. Create a key named <strong>Grokbot</strong>. Enable write access if you want it to draft and manage outreach.</li>
      <li>Copy the new key once, paste it below, and press <strong>Connect and verify</strong>.</li>
    </ol>
    <p>If API keys is missing, ask a workspace administrator to create the key or grant you access. Signing in to Vercel alone does not grant Atlas workspace access.</p>
    <label htmlFor="atlas-connection-name">Connection name</label>
    <input id="atlas-connection-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder="Atlas · Hive"/>
    <label htmlFor="atlas-workspace-key">Atlas workspace key</label>
    <input id="atlas-workspace-key" type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} required placeholder="atlas_sk_…"/>
    <p className="field-help">The key is encrypted on the server. Verification only reads workspace access; it does not send emails.</p>
    {error ? <p role="alert" className="connector-error">{error}</p> : null}
    <button className="btn-primary" disabled={busy || !key.trim() || !name.trim()}>{busy ? 'Connecting and verifying…' : 'Connect and verify'}</button>
  </form>;
}
