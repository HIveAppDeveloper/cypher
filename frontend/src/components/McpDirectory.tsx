'use client';

import { useEffect, useState } from 'react';
import { LoadingState } from './LoadingState';
import { api } from '../lib/api';

export interface McpDirectoryEntry {
  id: string;
  registry_name: string;
  version: string;
  name: string;
  url: string;
  description: string;
  category: string;
  icon?: string | null;
  domains: string[];
  source: string;
  transport: string;
  setup_note: string;
  test_status: string;
  test_message: string;
  tool_count: number | null;
  auth: string;
}

export interface McpDirectoryPage {
  items: McpDirectoryEntry[];
  categories: string[];
  offset: number;
  limit: number;
  total: number;
  count: number;
  fetched_at?: string | null;
  source?: string;
}

export interface McpToolPreview {
  status: string;
  message: string;
  tools: { name: string; description: string; read_only: boolean }[];
  tool_count: number | null;
}

const PAGE_SIZE = 24;

function statusLabel(status: string) {
  if (status === 'protocol_verified') return 'Connection checked';
  if (status === 'auth_required') return 'Sign-in required';
  if (status === 'not_tested') return 'Not checked yet';
  if (status === 'local_setup') return 'Needs setup';
  if (status === 'transport_unsupported') return 'Different connection type';
  if (status === 'no_endpoint') return 'No hosted address';
  if (status === 'unavailable') return 'Currently unavailable';
  if (status === 'server_error') return 'Server error';
  if (status === 'unsafe_or_unresolved') return 'Address could not be checked';
  if (status === 'not_mcp') return 'Not an MCP server';
  return 'Connection not checked';
}

export function McpDirectory({
  busy,
  connectedUrls,
  onConnect,
}: {
  busy: boolean;
  connectedUrls: string[];
  onConnect: (entry: { id: string; name: string; url: string; description: string; category: string; domains: string[]; icon?: string; source?: string; auth?: string; setup_note?: string; transport?: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState<'all' | 'hosted' | 'local' | 'verified' | 'auth'>('all');
  const [items, setItems] = useState<McpDirectoryEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [count, setCount] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [openPreview, setOpenPreview] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<Record<string, McpToolPreview>>({});
  const [previewBusy, setPreviewBusy] = useState<Record<string, boolean>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      setItems([]);
      api.getMcpDirectory({ q: query.trim(), category, kind, offset: 0, limit: PAGE_SIZE })
        .then(page => {
          if (!active) return;
          setItems(page.items);
          setCategories(page.categories);
          setTotal(page.total);
          setCount(page.count);
          setFetchedAt(page.fetched_at || null);
        })
        .catch(reason => {
          if (active) setError(reason instanceof Error ? reason.message : 'The MCP directory could not load.');
        })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [query, category, kind, retry]);

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await api.getMcpDirectory({ q: query.trim(), category, kind, offset: items.length, limit: PAGE_SIZE });
      setItems(current => {
        const seen = new Set(current.map(item => item.id));
        return [...current, ...page.items.filter(item => !seen.has(item.id))];
      });
      setTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more servers.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadPreview(entry: McpDirectoryEntry) {
    if (previewBusy[entry.id]) return;
    setPreviewBusy(current => ({ ...current, [entry.id]: true }));
    setPreviewErrors(current => ({ ...current, [entry.id]: '' }));
    try {
      const result = await api.getMcpDirectoryPreview(entry.id);
      setPreviews(current => ({ ...current, [entry.id]: result }));
    } catch (reason) {
      setPreviewErrors(current => ({ ...current, [entry.id]: reason instanceof Error ? reason.message : 'The tool preview could not load.' }));
    } finally {
      setPreviewBusy(current => ({ ...current, [entry.id]: false }));
    }
  }

  function togglePreview(entry: McpDirectoryEntry) {
    const next = !openPreview[entry.id];
    setOpenPreview(current => ({ ...current, [entry.id]: next }));
    if (next && !previews[entry.id] && !previewBusy[entry.id]) void loadPreview(entry);
  }

  function retryPreview(entry: McpDirectoryEntry) {
    setPreviews(current => { const next = { ...current }; delete next[entry.id]; return next; });
    setOpenPreview(current => ({ ...current, [entry.id]: true }));
    void loadPreview(entry);
  }

  return <section className="mcp-directory-panel" aria-label="Full MCP directory">
    <div className="catalog-heading"><div><h3>Full MCP directory <span>{count.toLocaleString()}</span></h3><p>Find a service you already use and sign in to connect it.</p></div></div>
    <label className="mcp-directory-search" htmlFor="mcp-directory-search">Find a tool or service</label>
    <input id="mcp-directory-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try GitHub, Notion, maps…" maxLength={120} />
    <div className="mcp-directory-toolbar">
      <label htmlFor="mcp-directory-category">Category</label>
      <select id="mcp-directory-category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select>
      <label htmlFor="mcp-directory-kind">Show</label>
      <select id="mcp-directory-kind" value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="all">Everything</option><option value="hosted">Hosted services</option><option value="verified">Connection checked</option><option value="auth">Sign-in required</option><option value="local">Needs setup or hosting</option></select>
    </div>
    <p className="mcp-directory-permissions">Choose a service, sign in, then review and approve the access it asks for. The connection uses the permissions the service publishes. You can turn off tools later.</p>
    <p className="catalog-results" role="status">{loading ? 'Loading the directory…' : `${items.length.toLocaleString()} of ${total.toLocaleString()} matches · ${count.toLocaleString()} listings total`}{fetchedAt ? ` · updated ${new Date(fetchedAt).toLocaleDateString()}` : ''}</p>
    {loading && !items.length ? <LoadingState label="Loading the directory…" rows={4}/> : null}
    {error ? <p className="connector-error" role="alert">{error} <button type="button" className="connector-retry" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : null}
    {loading ? null : !items.length ? <p className="connector-empty">No services match that search. Try another name or choose “Everything”.</p> : <div className="connector-catalog">{items.map(entry => {
      const connected = connectedUrls.includes(entry.url);
      const preview = previews[entry.id];
      const canConnect = Boolean(entry.url) && !entry.setup_note;
      const action = connected ? 'Connected' : entry.test_status === 'auth_required' ? 'Sign in & approve' : 'Connect';
      return <article className="connector-entry mcp-directory-entry" key={entry.id}>
        <div className="connector-entry-title"><span className="connector-logo">{entry.icon ? <img src={entry.icon} alt="" loading="lazy"/> : <span>{entry.name.slice(0, 2).toUpperCase()}</span>}</span><div><h4>{entry.name}</h4><span>{entry.category}</span></div></div>
        <span className="mcp-directory-status" data-status={entry.test_status}>{statusLabel(entry.test_status)}{entry.tool_count !== null ? ` · ${entry.tool_count} tools` : ''}</span>
        <p className="connector-entry-description">{entry.description || 'No description was provided by the publisher.'}</p>
        {entry.setup_note ? <p className="connector-detail">{entry.setup_note}</p> : null}
        {canConnect ? <div className="connector-tool-preview">
          <button type="button" className="connector-preview-toggle" aria-expanded={Boolean(openPreview[entry.id])} onClick={() => togglePreview(entry)}>{openPreview[entry.id] ? 'Hide tools' : 'See example tools'}</button>
          {openPreview[entry.id] ? <div className="connector-tool-preview-content" aria-live="polite">
            {previewBusy[entry.id] ? <p>Checking what this service can do…</p> : null}
            {previewErrors[entry.id] ? <p>{previewErrors[entry.id]} <button type="button" onClick={() => retryPreview(entry)}>Try again</button></p> : null}
            {preview ? <>{preview.message ? <p>{preview.message}</p> : null}{preview.tools.length ? <><div className="connector-tool-preview-heading"><strong>Example tools</strong><span>{preview.tool_count ?? preview.tools.length} found</span></div><ul>{preview.tools.map(tool => <li key={tool.name}><strong>{tool.name.replace(/[_-]+/g, ' ')}</strong><span>{tool.description || 'The service did not provide a description.'}</span>{tool.read_only ? <small>Read-only preview</small> : null}</li>)}</ul></> : null}{preview.status === 'auth_required' ? <small>Connect and approve access to see this service’s tools.</small> : null}</> : null}
          </div> : null}
        </div> : null}
        <div className="connector-entry-footer"><a href={entry.source || 'https://registry.modelcontextprotocol.io/'} target="_blank" rel="noreferrer">Publisher info</a><button type="button" className="connector-connect" disabled={busy || !canConnect || connected} aria-label={`${action} ${entry.name}`} onClick={() => onConnect({ ...entry, icon: entry.icon || undefined, auth: 'auto' })}>{action}<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button></div>
      </article>;
    })}</div>}
    {items.length < total ? <button type="button" className="btn-secondary" disabled={loadingMore || loading} onClick={() => void loadMore()}>{loadingMore ? 'Loading more…' : `Show more (${(total - items.length).toLocaleString()} left)`}</button> : null}
  </section>;
}
