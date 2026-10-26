import { useEffect, useRef, useState } from 'react';
import { ModelConnection, ModelConnections } from './ModelConnections';
import { dateFromApi } from '../lib/dates';
type CloudCheck = { status: string; detail?: { message?: string }; checked_at?: string };
type Runtime = { worker?: boolean; worker_version_matches?: boolean | null; database?: boolean; model_configured?: boolean; model_transport?: string; connected?: boolean; checks?: Record<string, CloudCheck>; can_manage_model_connections?: boolean; model_connections?: ModelConnection[] };
const CHECK_LABELS: Record<string, string> = { starter_plugins: 'Starter plugin connections', media_openai: 'OpenAI image generation', fleet: 'Agent orchestration', model: 'GPT-6.1 Sol', fallback: 'GPT-6 Luna', mcp: 'MCP tool call', browser: 'Hosted browser', computer: 'Cloud computer' };
export function WorkspaceSetup({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Runtime>({});
  const [status, setStatus] = useState('checking');
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [geminiTest, setGeminiTest] = useState<'idle'|'running'|'passed'|'failed'>('idle');
  const [geminiMessage, setGeminiMessage] = useState('');
  const requestStatus = detail.checks?.check_request?.status;
  const pending = submitting || requestStatus === 'pending' || requestStatus === 'running' || detail.model_connections?.some(item => item.state === 'checking');
  async function check() {
    setStatusError('');
    try {
      const response = await fetch('/api/runtime', { cache: 'no-store' });
      if (!response.ok) throw new Error('Runtime check failed.');
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Runtime check returned invalid data.');
      setDetail(data); setStatus(data.connected ? 'connected' : 'disconnected'); setError('');
    }
    catch { setStatus('error'); setStatusError('Could not check the cloud runtime. Refresh to try again.'); }
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
  async function testGemini() {
    setGeminiTest('running'); setGeminiMessage('');
    try {
      const response = await fetch('/api/runtime/models/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'gemini', model: 'gemini-3.8-flash' }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Gemini could not be verified. Check the OmniRoute provider and try again.');
      setGeminiTest('passed'); setGeminiMessage('Gemini 3.8 Flash replied through the configured model route.');
    } catch (failure) {
      setGeminiTest('failed'); setGeminiMessage(failure instanceof Error ? failure.message : 'Gemini could not be verified. Check the provider connection and try again.');
    }
  }
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); void check(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => { const timer = setInterval(() => void check(), pending ? 3000 : 5000); return () => clearInterval(timer); }, [pending]);
  const workerUpdating = detail.worker_version_matches === false;
  const hasRuntimeStatus = Object.keys(detail).length > 0;
  const knownModelTransport = detail.model_transport === 'direct' || detail.model_transport === 'omniroute';
  const directModelTransport = detail.model_transport === 'direct';
  const modelPassed = detail.checks?.model?.status === 'passed';
  const modelFailed = detail.checks?.model?.status === 'failed';
  return <dialog ref={dialog} className="bot-dialog setup-dialog" aria-labelledby="setup-title" onCancel={onClose}>
    <h2 id="setup-title">Your cloud workspace</h2><p className="dialog-intro">One setup. Then work from any device.</p>
    <div className="agent-form"><div className="agent-form-fields">
      <div className="connection-state" data-state={status}><span className="connection-dot"/><div><strong>{status === 'checking' ? 'Checking connection…' : status === 'error' ? 'Cloud status unavailable' : detail.connected ? detail.worker ? 'Cloud workspace connected' : 'Cloud API connected · worker not ready' : 'Cloud runtime not connected'}</strong><p>{status === 'error' ? hasRuntimeStatus ? 'Showing the last successful runtime check. Its status may be out of date.' : 'The setup details are hidden until Cypher can check the runtime.' : detail.connected ? 'Database and worker readiness are separate from model and tool access.' : 'Agents need a reachable hosted runtime before they can work.'}</p></div></div>
      {statusError ? <p role="alert" className="form-error">{statusError} <button type="button" className="btn-secondary" onClick={() => void check()}>Retry status check</button></p> : null}
      {directModelTransport ? <section className="provider-setup" aria-labelledby="gemini-setup-title">
        <h3 id="gemini-setup-title">Connect Gemini</h3>
        <p>Add your Gemini API key in Model access below. We verify it with a short model request and use it directly for Gemini calls.</p>
        <div className="provider-setup-actions">
          <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Get a Gemini API key</a>
        </div>
        <p className="provider-setup-note">A Google AI Pro or Gemini subscription is not an API key for this app. Gemini API usage has separate quota and billing.</p>
        <div className="provider-test">
          <button type="button" className="btn-secondary" disabled={geminiTest === 'running'} onClick={() => void testGemini()}>{geminiTest === 'running' ? 'Testing Gemini…' : geminiTest === 'passed' ? 'Test again' : 'Test Gemini connection'}</button>
          {geminiMessage ? <p data-state={geminiTest} role={geminiTest === 'failed' ? 'alert' : 'status'}>{geminiMessage}</p> : null}
        </div>
        <p className="provider-test-cost">Testing sends one short request to Gemini and may use your provider quota.</p>
      </section> : null}
      {hasRuntimeStatus ? <ol className="setup-steps">
        <li><strong>{detail.database ? 'Database connected' : 'Connect your database'}</strong><p>Agent history stays in a separate PostgreSQL schema.</p></li>
        <li><strong>{modelPassed ? 'Model response verified' : !knownModelTransport ? 'Model route not confirmed' : detail.model_configured ? 'Model connection configured' : 'Enable model access'}</strong><p>{!knownModelTransport ? 'Cypher could not confirm how model requests are routed. Refresh the runtime status before changing provider settings.' : detail.model_transport === 'omniroute' ? modelFailed ? 'The OmniRoute check failed. Your saved tasks remain available; verify the connection again to see its current state.' : 'Model requests use your existing OmniRoute connection. Provider account limits still apply.' : modelFailed ? 'The last model check failed. Check the configured provider connection, then verify again.' : 'Model requests use your configured provider connection.'}</p></li>
        <li><strong>{detail.worker ? 'Cloud worker responding' : workerUpdating ? 'Cloud worker updating' : 'Cloud worker not ready'}</strong><p>{workerUpdating ? 'The worker is still on an earlier release. This status updates automatically when the current release starts.' : 'A running cloud worker continues queued tasks when this page closes or your laptop is off.'}</p></li>
      </ol> : null}
      {knownModelTransport && detail.can_manage_model_connections ? <ModelConnections items={(detail.model_connections || []).filter(item => detail.model_transport === 'omniroute' || item.id === 'gemini' || item.id === 'xai')} canManage workerReady={!!detail.worker} onQueued={check} omniroute={detail.model_transport === 'omniroute'}/> : null}
      <details className="advanced-settings"><summary>Live check results</summary><p className="field-help">Run checks makes small model requests, reads public documentation, opens a test page, and starts then stops a test computer. It can use provider credits and cloud compute.</p><ul className="setup-steps">{Object.entries(CHECK_LABELS).map(([name, label]) => { const result = detail.checks?.[name]; const checkedAt = dateFromApi(result?.checked_at); return <li key={name}><strong>{label}: {result?.status || 'Not checked'}</strong>{checkedAt ? <p>Last checked {checkedAt.toLocaleString()}</p> : null}{result?.detail?.message ? <p>{result.detail.message}</p> : null}</li>; })}</ul></details>
      <details className="advanced-settings"><summary>Host in your AWS account</summary><p className="field-help">Sign in to AWS and create a private workspace you own. The template provisions one EC2 host, an encrypted 60 GB disk, PostgreSQL, Redis, HTTPS, and an owner login. AWS bills these resources to your account.</p><ol className="setup-steps"><li><strong>Prepare your account</strong><p>Choose a domain you control. Save your OpenAI API key as an SSM SecureString named /grokbot/openai-api-key in the AWS region you will use.</p></li><li><strong>Review and launch</strong><p>Download the template. In CloudFormation choose Create stack → Upload a template file. Select your VPC and public subnet, enter your domain, review the resources and IAM permissions, then create the stack.</p></li><li><strong>Open your private workspace</strong><p>Point your domain to the HostAddress stack output. Sign in as owner using the password in the LoginPasswordParameter SSM SecureString. Credentials stay in your AWS account. Stack creation waits for the API and database to respond.</p></li></ol><a className="setup-doc-link" href="/setup/aws-workspace.json" download>Download AWS template</a><a className="setup-doc-link" href="https://console.aws.amazon.com/cloudformation/home#/stacks/create/template" target="_blank" rel="noreferrer">Sign in to AWS and create workspace</a><p className="field-help">This is a single-host deployment. Configure backups before relying on it. Creating a stack is the approval step; downloading this template creates no resources.</p></details>
      {detail.model_transport === 'omniroute' && detail.can_manage_model_connections ? <details className="advanced-settings"><summary>Use provider subscriptions</summary><p className="field-help">Provider sign-in methods vary. Use an available in-app connection method or API key, then choose Check provider access to verify an actual model response. Browser subscription sign-in is unavailable until its supported connection flow is enabled. A ChatGPT/Codex, Google, Anthropic or Grok subscription does not automatically provide API access. Public model routes do not verify a subscription. Meta model access is separate from Facebook and Instagram permissions.</p></details> : null}
      <details className="advanced-settings"><summary>Deployment guide</summary><p className="field-help">The managed deployment includes a private backend and persistent worker. A successful check verifies only the operation named.</p><a className="setup-doc-link" href="https://github.com/HIveAppDeveloper/cypher/blob/main/SETUP.md" target="_blank" rel="noreferrer">Open setup instructions</a></details>
      {pending ? <p role="status" className="field-help">Cloud checks {requestStatus === 'pending' ? 'queued' : 'running'}. You can close this window; the worker continues.</p> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div><div className="dialog-actions"><button className="btn-secondary" onClick={() => void check()}>Refresh</button><button disabled={pending || !detail.worker} className="btn-secondary" onClick={() => void runChecks()}>{pending ? 'Verifying…' : 'Verify models and tools'}</button><button className="btn-primary" onClick={onClose}>Done</button></div></div>
  </dialog>;
}
