import { useEffect, useRef, useState } from 'react';
type CloudCheck = { status: string; detail?: { message?: string }; checked_at?: string };
type Runtime = { worker?: boolean; database?: boolean; gateway_configured?: boolean; connected?: boolean; checks?: Record<string, CloudCheck> };
const CHECK_LABELS: Record<string, string> = { gateway: 'GPT-6.1 Sol', fallback: 'GPT-6 Luna', mcp: 'MCP tool call', browser: 'Hosted browser', computer: 'Cloud computer' };
export function WorkspaceSetup({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Runtime>({});
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const requestStatus = detail.checks?.check_request?.status;
  const pending = submitting || requestStatus === 'pending' || requestStatus === 'running';
  async function check() {
    try { const response = await fetch('/api/runtime', { cache: 'no-store' }); const data = await response.json(); setDetail(data); setStatus(data.connected ? 'connected' : 'disconnected'); }
    catch { setStatus('disconnected'); }
  }
  async function runChecks() {
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/runtime/checks', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Could not queue cloud checks.');
      setDetail(previous => ({ ...previous, checks: { ...previous.checks, check_request: { status: data.status } } }));
      await check();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not queue cloud checks.'); }
    finally { setSubmitting(false); }
  }
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); void check(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => { if (!pending) return; const timer = setInterval(() => void check(), 3000); return () => clearInterval(timer); }, [pending]);
  const modelPassed = detail.checks?.gateway?.status === 'passed';
  const modelFailed = detail.checks?.gateway?.status === 'failed';
  return <dialog ref={dialog} className="bot-dialog setup-dialog" aria-labelledby="setup-title" onCancel={onClose}>
    <h2 id="setup-title">Your cloud workspace</h2><p className="dialog-intro">One setup. Then work from any device.</p>
    <div className="agent-form"><div className="agent-form-fields">
      <div className="connection-state" data-state={status}><span className="connection-dot"/><div><strong>{status === 'checking' ? 'Checking connection…' : detail.connected ? detail.worker ? 'Cloud workspace connected' : 'Cloud API connected · worker not ready' : 'Cloud runtime not connected'}</strong><p>{detail.connected ? 'Database and worker readiness are separate from model and tool access.' : 'Agents need a reachable hosted runtime before they can work.'}</p></div></div>
      <ol className="setup-steps">
        <li><strong>{detail.database ? 'Database connected' : 'Connect your database'}</strong><p>Agent history stays in a separate PostgreSQL schema.</p></li>
        <li><strong>{modelPassed ? 'GPT-6.1 Sol response verified' : detail.gateway_configured ? 'Model gateway configured' : 'Enable model access'}</strong><p>{modelFailed ? 'The last model check failed. Check gateway access and credits, then run checks again.' : 'Model requests use gateway credits, separately from a ChatGPT subscription.'}</p></li>
        <li><strong>{detail.worker ? 'Cloud worker responding' : 'Cloud worker not ready'}</strong><p>A running cloud worker continues queued tasks when this page closes or your laptop is off.</p></li>
      </ol>
      {modelFailed ? <a className="setup-doc-link" href="https://vercel.com/hiveapp/~/ai" target="_blank" rel="noreferrer">Open AI Gateway billing and access</a> : null}
      <details className="advanced-settings"><summary>Live check results</summary><p className="field-help">Run checks makes small model requests, reads public documentation, opens a test page, and starts then stops a test computer. It can use provider credits and cloud compute.</p><ul className="setup-steps">{Object.entries(CHECK_LABELS).map(([name, label]) => { const result = detail.checks?.[name]; return <li key={name}><strong>{label}: {result?.status || 'Not checked'}</strong>{result?.checked_at ? <p>Last checked {new Date(result.checked_at).toLocaleString()}</p> : null}</li>; })}</ul></details>
      <details className="advanced-settings"><summary>Deployment guide</summary><p className="field-help">The managed deployment includes a private backend and persistent worker. A successful check verifies only the operation named.</p><a className="setup-doc-link" href="https://github.com/HIveAppDeveloper/open-grokbot/blob/main/SETUP.md" target="_blank" rel="noreferrer">Open setup instructions</a></details>
      {pending ? <p role="status" className="field-help">Cloud checks {requestStatus === 'pending' ? 'queued' : 'running'}. You can close this window; the worker continues.</p> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div><div className="dialog-actions"><button className="btn-secondary" onClick={() => void check()}>Refresh</button><button disabled={pending || !detail.worker} className="btn-secondary" onClick={() => void runChecks()}>{pending ? 'Checking…' : 'Run checks'}</button><button className="btn-primary" onClick={onClose}>Done</button></div></div>
  </dialog>;
}
