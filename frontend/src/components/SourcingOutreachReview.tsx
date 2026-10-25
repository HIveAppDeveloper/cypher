'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, request } from '../lib/api';
import { canCancelProposal, canCreateDraftProposal, canReviewProposal, outreachStatus, outreachTime, proposalIdIsValid, type OutreachProposal, type SendingAccount } from '../lib/sourcing-outreach';
import './sourcing-outreach-review.css';

const endpoint = '/sourcing/outreach';
type Action = 'review' | 'cancel' | 'create-draft';

export default function SourcingOutreachReview({ initialProposalId = '', initialSourceRunId = '', initialSourceResultId = '' }: { initialProposalId?: string; initialSourceRunId?: string; initialSourceResultId?: string }) {
  const [accounts, setAccounts] = useState<SendingAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [proposal, setProposal] = useState<OutreachProposal | null>(null);
  const [reviewToken, setReviewToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [signIn, setSignIn] = useState(false);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  const pending = useRef(false);
  const heading = useRef<HTMLElement>(null);
  const draftRequest = useRef<{ fingerprint: string; id: string } | null>(null);

  function accept(row: OutreachProposal) {
    // Review nonces are short-lived and stay only in component memory.
    const { review_token: token, ...saved } = row;
    setProposal(saved);
    setReviewToken(token || null);
    setConfirmed(false);
    setNeedsStatusCheck(false);
    const serverTime = outreachTime(row.server_time);
    if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now());
    setClock(Date.now());
  }

  function explain(cause: unknown) {
    if (cause instanceof ApiError) {
      if (cause.status === 401) {
        setSignIn(true);
        setError('Sign in to continue with this email.');
        return;
      }
      if (cause.status === 409 || cause.status === 503) {
        setError('Cypher can’t use that Gmail account yet. Check its connection in Apps, then try again.');
        return;
      }
      if (cause.status === 422) {
        setError('Check the recipient email, subject, and message, then try again.');
        return;
      }
      if (cause.status === 429) {
        setError('Cypher is handling another request. Wait a moment, then try again.');
        return;
      }
    }
    setError('Cypher couldn’t finish that step. Your saved work is safe. Refresh the status before trying again.');
  }

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        if (initialProposalId && !proposalIdIsValid(initialProposalId)) throw new Error('This proposal link is invalid. Open its original review link.');
        const sourceIsValid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(initialSourceRunId)
          && /^[A-Za-z0-9._:-]{1,128}$/.test(initialSourceResultId);
        const [accountResult, proposalResult, sourceResult] = await Promise.allSettled([
          request(endpoint + '/accounts', { signal: controller.signal }),
          initialProposalId ? request(endpoint + '/' + encodeURIComponent(initialProposalId), { signal: controller.signal }) : Promise.resolve(null),
          !initialProposalId && (initialSourceRunId || initialSourceResultId)
            ? sourceIsValid
              ? request(`/prospecting/investors/runs/${encodeURIComponent(initialSourceRunId)}/results/${encodeURIComponent(initialSourceResultId)}/outreach`, { method: 'POST', signal: controller.signal })
              : Promise.reject(new Error('invalid-source-link'))
            : Promise.resolve(null),
        ]);
        if (!active.current || controller.signal.aborted) return;
        if (accountResult.status === 'fulfilled') {
          const saved = accountResult.value;
          if (Array.isArray(saved.accounts)) {
            setAccounts(saved.accounts);
            const eligible = saved.accounts.filter((row: SendingAccount) => row.available && row.sender);
            setAccountId((eligible.find((row: SendingAccount) => row.provider === 'gmail') || eligible[0])?.id || '');
          } else explain(new Error('Sending accounts could not load. Refresh to try again.'));
        } else explain(accountResult.reason);
        if (proposalResult.status === 'fulfilled' && proposalResult.value) accept(proposalResult.value);
        else if (proposalResult.status === 'rejected') explain(proposalResult.reason);
        if (sourceResult.status === 'fulfilled' && sourceResult.value) {
          setSubject(sourceResult.value.subject || '');
          setBody(sourceResult.value.body || '');
          setRecipient('');
        } else if (sourceResult.status === 'rejected') {
          if (sourceResult.reason instanceof ApiError && sourceResult.reason.status === 401) explain(sourceResult.reason);
          else setError('Cypher couldn’t reopen this researched match. Return to VC Intelligence and prepare the draft again.');
        }
      } catch (cause) {
        if (active.current && !controller.signal.aborted) explain(cause);
      } finally {
        if (active.current && !controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => { active.current = false; controller.abort(); };
  }, [initialProposalId, initialSourceResultId, initialSourceRunId, reload]);

  useEffect(() => {
    if (!proposal || proposal.status !== 'awaiting_approval') return;
    const timer = setTimeout(() => setClock(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [proposal, clock]);

  async function createProposal(event: FormEvent) {
    event.preventDefault();
    const account = accounts.find(row => row.id === accountId && row.available && row.sender);
    if (!account || pending.current) return;
    const content = { provider: account.provider, account_id: account.id, recipient, subject, body };
    const fingerprint = JSON.stringify(content);
    if (draftRequest.current?.fingerprint !== fingerprint) draftRequest.current = { fingerprint, id: crypto.randomUUID() };
    pending.current = true;
    setBusy('prepare'); setError('');
    try {
      const row = await request(endpoint, { method: 'POST', body: JSON.stringify({ request_id: draftRequest.current.id, ...content }) });
      if (!active.current) return;
      accept(row);
      window.history.replaceState(null, '', '/sourcing/outreach?proposal=' + encodeURIComponent(row.id));
      heading.current?.scrollIntoView({ block: 'start' });
    } catch (cause) { if (active.current) explain(cause); }
    finally { pending.current = false; if (active.current) setBusy(''); }
  }

  async function refreshStatus() {
    if (!proposal || pending.current) return;
    pending.current = true; setBusy('refresh'); setError('');
    try {
      const row = await request(endpoint + '/' + encodeURIComponent(proposal.id));
      if (active.current) accept(row);
    } catch (cause) { if (active.current) explain(cause); }
    finally { pending.current = false; if (active.current) setBusy(''); }
  }

  async function act(action: Action) {
    if (!proposal || pending.current || needsStatusCheck) return;
    const now = Date.now() + clockOffset;
    if (action === 'create-draft' && !canCreateDraftProposal(proposal, now)) return;
    if (action === 'review' && !canReviewProposal(proposal, now)) return;
    if (action === 'cancel' && !canCancelProposal(proposal)) return;
    pending.current = true; setBusy(action); setError('');
    try {
      const options: RequestInit = { method: 'POST' };
      if (action === 'create-draft') options.body = JSON.stringify({ digest: proposal.digest, review_token: reviewToken, confirmation: 'create_gmail_draft_exact_message_and_account' });
      const path = action === 'create-draft' ? 'create-draft' : action;
      const row = await request(`${endpoint}/${encodeURIComponent(proposal.id)}/${path}`, options);
      if (active.current) accept(row);
    } catch (cause) {
      if (!active.current) return;
      explain(cause);
      setReviewToken(null); setConfirmed(false);
      // A lost response never triggers another mutation. Inspect the saved row.
      if (action !== 'review') {
        setNeedsStatusCheck(true);
        try {
          const row = await request(endpoint + '/' + encodeURIComponent(proposal.id));
          if (active.current) accept(row);
        } catch { /* Keep the error and require an explicit status refresh. */ }
      }
    } finally { pending.current = false; if (active.current) setBusy(''); }
  }

  const now = clock + clockOffset;
  const eligible = accounts.filter(row => row.available && row.sender);
  const selectedAccount = accounts.find(row => row.id === accountId);
  const status = proposal ? outreachStatus(proposal) : null;
  const eligibilityKnown = !!proposal && typeof proposal.review_eligible === 'boolean' && typeof proposal.creation_eligible === 'boolean' && typeof proposal.recipient_policy?.held === 'boolean' && typeof proposal.recipient_policy?.suppressed === 'boolean';
  const reviewCurrent = !!proposal && !!reviewToken && proposal.creation_eligible && proposal.recipient_policy?.held === false && proposal.recipient_policy?.suppressed === false && proposal.status === 'awaiting_approval' && outreachTime(proposal.review_expires_at) > now;

  return <main className="outreach-review" aria-labelledby="outreach-title">
    <header ref={heading} className="outreach-heading"><a href="/prospecting/investors">Back to VC intelligence</a><h1 id="outreach-title">{proposal || initialProposalId ? 'Review outreach' : 'Prepare outreach'}</h1><p>{proposal || initialProposalId ? 'Check the recipient, Gmail account, and email before confirming it.' : 'Choose a Gmail account and prepare one email for review.'}</p></header>
    {error ? <div className="outreach-error" role="alert"><p>{error}</p>{signIn ? <a href={'/login?returnTo=' + encodeURIComponent('/sourcing/outreach' + (proposal || initialProposalId ? '?proposal=' + encodeURIComponent(proposal?.id || initialProposalId) : initialSourceRunId && initialSourceResultId ? '?run=' + encodeURIComponent(initialSourceRunId) + '&result=' + encodeURIComponent(initialSourceResultId) : ''))}>Sign in to continue</a> : proposal ? <button type="button" onClick={() => void refreshStatus()} disabled={!!busy}>Refresh saved status</button> : <button type="button" onClick={() => setReload(value => value + 1)} disabled={!!busy}>Reload workspace</button>}</div> : null}
    {loading ? <p className="outreach-loading" role="status">Loading your outreach workspace…</p> : proposal ? <>
      <section className="outreach-status" aria-labelledby="outreach-status-title"><div><h2 id="outreach-status-title">{status?.label}</h2><p role="status">{status?.message}</p></div><button type="button" onClick={() => void refreshStatus()} disabled={!!busy}>{busy === 'refresh' ? 'Checking…' : 'Refresh status'}</button></section>
      <section className="outreach-message" aria-label="Email for review"><dl><div><dt>From</dt><dd>{proposal.sender}<small>Gmail account chosen for this email</small></dd></div><div><dt>To</dt><dd>{proposal.recipient}</dd></div><div><dt>Subject</dt><dd>{proposal.subject}</dd></div></dl><div className="outreach-body">{proposal.body}</div></section>
      {needsStatusCheck ? <p role="status">Cypher couldn’t confirm the last step. Refresh this email’s status before continuing.</p> : null}
      {!eligibilityKnown ? <p role="status">Cypher couldn’t check whether this recipient is eligible. Refresh the status before continuing.</p> : null}
      {reviewCurrent ? <div className="outreach-confirmation"><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!!busy || needsStatusCheck} /><span>I want to save this email as a Gmail draft from <strong>{proposal.sender}</strong> to <strong>{proposal.recipient}</strong>.</span></label><p>Cypher will save it as a draft only. It will not send the email.</p><button type="button" className="outreach-primary" onClick={() => void act('create-draft')} disabled={!!busy || needsStatusCheck || !confirmed || !canCreateDraftProposal(proposal, now)}>{busy === 'create-draft' ? 'Saving Gmail draft…' : 'Confirm and create Gmail draft'}</button></div> : canReviewProposal(proposal, now) ? <div className="outreach-actions"><button type="button" className="outreach-primary" onClick={() => void act('review')} disabled={!!busy || needsStatusCheck}>{busy === 'review' ? 'Preparing review…' : 'Review email'}</button></div> : null}
      <footer className="outreach-footer">{canCancelProposal(proposal) ? <button type="button" onClick={() => void act('cancel')} disabled={!!busy || needsStatusCheck}>{busy === 'cancel' ? 'Cancelling…' : 'Cancel email'}</button> : null}{proposal.gmail_draft_id ? <p><a href={`https://mail.google.com/mail/?authuser=${encodeURIComponent(proposal.sender)}#drafts`} target="_blank" rel="noreferrer">Open Gmail Drafts</a><small> Draft saved. Review and send it in Gmail when you’re ready.</small></p> : null}<p>{proposal.attempted_at ? 'If Cypher could not confirm the result, check Gmail Drafts before trying again.' : <>The recipient and message are fixed after confirmation. To change them, <a href="/sourcing/outreach">prepare another email</a>.</>}</p></footer>
    </> : !initialProposalId ? <form className="outreach-form" onSubmit={createProposal}>
      <p className="outreach-manual">{initialSourceRunId && initialSourceResultId ? 'Cypher filled in a draft from your research. Add a verified business email and review every detail before saving it to Gmail.' : 'Prepare one email to review. Cypher will only save it as a Gmail draft after you confirm the exact message.'}</p>
      {initialSourceRunId && initialSourceResultId ? <p className="outreach-field-note">SEC filings don’t provide verified email addresses. Confirm the recipient’s current work email before continuing.</p> : null}
      {!eligible.length ? <div className="outreach-empty"><h2>Connect Gmail</h2><p>Connect Gmail in Apps and allow draft access. Then come back here to review your email.</p><a href="/?plugins=1">Open Apps</a></div> : <>
        <label htmlFor="outreach-account">Gmail account</label><select id="outreach-account" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={!!busy}>{accounts.map(row => <option key={row.id} value={row.id} disabled={!row.available || !row.sender}>{row.sender || 'Gmail unavailable'}{row.available ? '' : ' · unavailable'}</option>)}</select>
        <p className="outreach-field-note">Your Gmail draft will come from {selectedAccount?.sender}. Cypher won’t send it.</p>
        <label htmlFor="outreach-recipient">Recipient</label><input id="outreach-recipient" type="email" autoComplete="off" value={recipient} onChange={event => setRecipient(event.target.value)} required disabled={!!busy} />
        <label htmlFor="outreach-subject">Subject</label><input id="outreach-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} required disabled={!!busy} />
        <label htmlFor="outreach-body">Message</label><textarea id="outreach-body" value={body} onChange={event => setBody(event.target.value)} rows={8} maxLength={20000} required disabled={!!busy} />
        <button type="submit" className="outreach-primary" disabled={!!busy || !accountId || !recipient.trim() || !subject.trim() || !body.trim()}>{busy === 'prepare' ? 'Preparing proposal…' : 'Prepare for review'}</button>
      </>}
      {accounts.filter(row => !row.available).map(row => <p className="outreach-account-note" key={row.id}>Gmail: Open Apps to reconnect this account or allow draft access.</p>)}
      <p className="outreach-footnote">Preparing a proposal does not send email. Only accounts already available to your workspace appear here.</p>
    </form> : null}
  </main>;
}
