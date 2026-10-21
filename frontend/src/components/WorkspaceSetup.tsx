import { useEffect, useRef, useState } from 'react';
type CloudCheck = { status: string; detail?: { message?: string }; checked_at?: string };
type Runtime = { worker?: boolean; worker_version_matches?: boolean | null; database?: boolean; gateway_configured?: boolean; connected?: boolean; checks?: Record<string, CloudCheck> };
const CHECK_LABELS: Record<string, string> = { starter_plugins: 'Starter plugin connections', media_openai: 'OpenAI image generation', media_google: 'Gemini image generation', media_video: 'Google video generation', fleet: 'Managed specialist fleet', gateway: 'GPT-6.1 Sol', fallback: 'GPT-6 Luna', mcp: 'MCP tool call', browser: 'Hosted browser', computer: 'Cloud computer' };
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
  useEffect(() => { const timer = setInterval(() => void check(), pending ? 3000 : 5000); return () => clearInterval(timer); }, [pending]);
  const workerUpdating = detail.worker_version_matches === false;
  const modelPassed = detail.checks?.gateway?.status === 'passed';
  const modelFailed = detail.checks?.gateway?.status === 'failed';
  return <dialog ref={dialog} className="bot-dialog setup-dialog" aria-labelledby="setup-title" onCancel={onClose}>
    <h2 id="setup-title">Your cloud workspace</h2><p className="dialog-intro">One setup. Then work from any device.</p>
    <div className="agent-form"><div className="agent-form-fields">
      <div className="connection-state" data-state={status}><span className="connection-dot"/><div><strong>{status === 'checking' ? 'Checking connection…' : detail.connected ? detail.worker ? 'Cloud workspace connected' : 'Cloud API connected · worker not ready' : 'Cloud runtime not connected'}</strong><p>{detail.connected ? 'Database and worker readiness are separate from model and tool access.' : 'Agents need a reachable hosted runtime before they can work.'}</p></div></div>
      <ol className="setup-steps">
        <li><strong>{detail.database ? 'Database connected' : 'Connect your database'}</strong><p>Agent history stays in a separate PostgreSQL schema.</p></li>
        <li><strong>{modelPassed ? 'GPT-6.1 Sol response verified' : detail.gateway_configured ? 'Model gateway configured' : 'Enable model access'}</strong><p>{modelFailed ? 'The last model check failed. Check gateway access and credits, then run checks again.' : 'Model requests use gateway credits, separately from a ChatGPT subscription.'}</p></li>
        <li><strong>{detail.worker ? 'Cloud worker responding' : workerUpdating ? 'Cloud worker updating' : 'Cloud worker not ready'}</strong><p>{workerUpdating ? 'The worker is still on an earlier release. This status updates automatically when the current release starts.' : 'A running cloud worker continues queued tasks when this page closes or your laptop is off.'}</p></li>
      </ol>
      {modelFailed ? <a className="setup-doc-link" href="https://vercel.com/hiveapp/~/ai" target="_blank" rel="noreferrer">Open AI Gateway billing and access</a> : null}
      <details className="advanced-settings"><summary>Live check results</summary><p className="field-help">Run checks makes small model requests, reads public documentation, opens a test page, and starts then stops a test computer. It can use provider credits and cloud compute.</p><ul className="setup-steps">{Object.entries(CHECK_LABELS).map(([name, label]) => { const result = detail.checks?.[name]; return <li key={name}><strong>{label}: {result?.status || 'Not checked'}</strong>{result?.checked_at ? <p>Last checked {new Date(result.checked_at).toLocaleString()}</p> : null}</li>; })}</ul></details>
      <details className="advanced-settings"><summary>Host in your AWS account</summary><p className="field-help">Sign in to AWS and create a private workspace you own. The template provisions one EC2 host, an encrypted 60 GB disk, PostgreSQL, Redis, HTTPS, and an owner login. AWS bills these resources to your account.</p><ol className="setup-steps"><li><strong>Prepare your account</strong><p>Choose a domain you control. Save your OpenAI API key as an SSM SecureString named /grokbot/openai-api-key in the AWS region you will use.</p></li><li><strong>Review and launch</strong><p>Download the template. In CloudFormation choose Create stack → Upload a template file. Select your VPC and public subnet, enter your domain, review the resources and IAM permissions, then create the stack.</p></li><li><strong>Open your private workspace</strong><p>Point your domain to the HostAddress stack output. Sign in as owner using the password in the LoginPasswordParameter SSM SecureString. Credentials stay in your AWS account. Stack creation waits for the API and database to respond.</p></li></ol><a className="setup-doc-link" href="/setup/aws-workspace.json" download>Download AWS template</a><a className="setup-doc-link" href="https://console.aws.amazon.com/cloudformation/home#/stacks/create/template" target="_blank" rel="noreferrer">Sign in to AWS and create workspace</a><p className="field-help">This is a single-host deployment. Configure backups before relying on it. Creating a stack is the approval step; downloading this template creates no resources.</p></details>
      <details className="advanced-settings"><summary>Use your ChatGPT plan</summary><p className="field-help">A ChatGPT plan can fund eligible AI requests; it does not host this server. OpenAI supports an account consent flow for open-source local installations and self-hosted VMs. This hosted website does not currently have an approved OpenAI sign-in client, so ChatGPT connection is unavailable here.</p><a className="setup-doc-link" href="https://developers.openai.com/siwc/token-sharing-open-source" target="_blank" rel="noreferrer">Open ChatGPT plan setup requirements</a><a className="setup-doc-link" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage ChatGPT plan usage</a></details>
      <details className="advanced-settings"><summary>Deployment guide</summary><p className="field-help">The managed deployment includes a private backend and persistent worker. A successful check verifies only the operation named.</p><a className="setup-doc-link" href="https://github.com/HIveAppDeveloper/open-grokbot/blob/main/SETUP.md" target="_blank" rel="noreferrer">Open setup instructions</a></details>
      {pending ? <p role="status" className="field-help">Cloud checks {requestStatus === 'pending' ? 'queued' : 'running'}. You can close this window; the worker continues.</p> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div><div className="dialog-actions"><button className="btn-secondary" onClick={() => void check()}>Refresh</button><button disabled={pending || !detail.worker} className="btn-secondary" onClick={() => void runChecks()}>{pending ? 'Checking…' : 'Run checks'}</button><button className="btn-primary" onClick={onClose}>Done</button></div></div>
  </dialog>;
}
