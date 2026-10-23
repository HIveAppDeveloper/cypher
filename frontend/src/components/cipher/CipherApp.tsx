'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MARKETS, PERSONAS, type Company } from '../../lib/cipher/markets';
import BinaryLens from './BinaryLens';
import ProspectBrain from './ProspectBrain';
import { SIGNAL_MAX, leadsToCsv, type Lead, type RunEvent, type SignalKind, type Stage } from '../../lib/cipher/engine';

type Step = Extract<RunEvent, { type: 'step' }>;
type View = 'brain' | 'accounts' | 'pipeline';
type Tier = Lead['tier'];
const STORE = 'cipher-territory-v2';
const KEY_STORE = 'cipher-openrouter-key';
const shortModel = (id: string) => id.split('/').pop() || id;
const KINDS: { id: SignalKind; label: string }[] = [
  { id: 'hiring', label: 'Hiring' }, { id: 'raising', label: 'Raising' }, { id: 'spending', label: 'Spending' }, { id: 'news', label: 'Momentum' },
];
const STAGES: { id: Stage; label: string }[] = [
  { id: 'drafted', label: 'Ready to send' }, { id: 'sent', label: 'In sequence' }, { id: 'replied', label: 'Replied' }, { id: 'meeting', label: 'Meeting booked' },
];
const stageLabel = (stage: Stage) => STAGES.find(s => s.id === stage)?.label ?? 'Queued';
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function load<T>(fallback: T): T { try { const v = localStorage.getItem(STORE); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }
function save(value: unknown) { try { localStorage.setItem(STORE, JSON.stringify(value)); } catch {} }

export default function CipherApp() {
  const [marketId, setMarketId] = useState(MARKETS[0].id);
  const [offering, setOffering] = useState('AI-driven outbound that books qualified meetings');
  const [persona, setPersona] = useState<string>(PERSONAS[0]);
  const [senderName, setSenderName] = useState('');
  const [tickers, setTickers] = useState('');
  const [webhook, setWebhook] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [scanning, setScanning] = useState<string[]>([]);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>('brain');
  const [filter, setFilter] = useState<'All' | Tier>('All');
  const [toast, setToast] = useState('');
  const [orKey, setOrKey] = useState('');
  const [serverAi, setServerAi] = useState(false);
  const [aiBusy, setAiBusy] = useState<string[]>([]);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [question, setQuestion] = useState('Who should we call first this week, and why?');
  const [answer, setAnswer] = useState<{ text: string; tickers: string[]; model: string; error?: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const leadsRef = useRef<Lead[]>([]);
  leadsRef.current = leads;
  const logRef = useRef<HTMLOListElement>(null);
  const ready = useRef(false);

  useEffect(() => {
    const s = load<null | Record<string, unknown>>(null);
    if (s) {
      if (typeof s.marketId === 'string') setMarketId(s.marketId);
      if (typeof s.offering === 'string') setOffering(s.offering);
      if (typeof s.persona === 'string') setPersona(s.persona);
      if (typeof s.senderName === 'string') setSenderName(s.senderName);
      if (typeof s.tickers === 'string') setTickers(s.tickers);
      if (typeof s.webhook === 'string') setWebhook(s.webhook);
      if (Array.isArray(s.leads)) setLeads(s.leads as Lead[]);
      if (Array.isArray(s.steps)) setSteps(s.steps as Step[]);
      if (typeof s.finishedAt === 'string') setFinishedAt(s.finishedAt);
    }
    try { setOrKey(localStorage.getItem(KEY_STORE) || ''); } catch {}
    fetch('/api/cipher/ai').then(r => r.json()).then((d: { serverKey?: boolean }) => setServerAi(Boolean(d.serverKey))).catch(() => {});
    ready.current = true;
  }, []);
  useEffect(() => { if (!ready.current) return; try { if (orKey.trim()) localStorage.setItem(KEY_STORE, orKey.trim()); else localStorage.removeItem(KEY_STORE); } catch {} }, [orKey]);
  useEffect(() => { if (ready.current && !running) save({ marketId, offering, persona, senderName, tickers, webhook, leads, steps: steps.slice(-300), finishedAt }); }, [marketId, offering, persona, senderName, tickers, webhook, leads, steps, finishedAt, running]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [steps.length]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!selected) return; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, [selected]);

  const market = MARKETS.find(m => m.id === marketId) ?? MARKETS[0];
  const customTickers = tickers.split(/[\s,]+/).map(t => t.trim().toUpperCase()).filter(t => /^[A-Z.]{1,6}$/.test(t)).slice(0, 20);
  const territory: Company[] = useMemo(() => {
    if (!customTickers.length) return market.companies;
    const known = new Map(MARKETS.flatMap(m => m.companies).map(c => [c.ticker, c]));
    return customTickers.slice(0, 20).map(t => known.get(t) ?? { name: t, ticker: t, domain: '', hq: 'Public company', snapshot: { openRoles: 0, gtmRoles: 0, raisedRecently: false, filings90d: 0, capexTrend: 'flat' } });
  }, [market, customTickers.join()]);
  const byId = useMemo(() => new Map(leads.map(l => [l.id, l])), [leads]);
  const ranked = useMemo(() => [...leads].sort((a, b) => b.score - a.score), [leads]);
  const rows = leads.length || running ? ranked : [];
  const visible = filter === 'All' ? rows : rows.filter(l => l.tier === filter);
  const pending = running ? territory.filter(c => !byId.has(c.ticker)) : [];
  const lead = selected ? byId.get(selected) ?? null : null;
  const count = (t: Tier) => leads.filter(l => l.tier === t).length;
  const launched = leads.filter(l => l.stage !== 'drafted').length;
  const meetings = leads.filter(l => l.stage === 'meeting').length;
  const readyHot = leads.filter(l => l.tier === 'Hot' && l.stage === 'drafted');

  const log = (text: string, tone: Step['tone'] = 'info', ticker?: string) => setSteps(s => [...s, { type: 'step', at: new Date().toISOString(), text, tone, ticker }]);
  const aiReady = serverAi || orKey.trim().length >= 20;
  const aiHeaders = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...(orKey.trim() ? { 'x-openrouter-key': orKey.trim() } : {}) });

  async function research(targets: Lead[]) {
    if (!targets.length || aiProgress) return;
    if (!aiReady) { setSetupOpen(true); setToast('Add an OpenRouter key in Setup to research with AI'); return; }
    const queue = [...targets]; let done = 0, stop = '';
    setAiProgress({ done: 0, total: targets.length });
    log(`AI research started on ${targets.length} account${targets.length > 1 ? 's' : ''}`);
    const worker = async () => {
      for (let t = queue.shift(); t && !stop; t = queue.shift()) {
        const target = t; const current = leadsRef.current.find(l => l.id === target.id) ?? target;
        setAiBusy(b => [...b, target.id]);
        try {
          const res = await fetch('/api/cipher/research', { method: 'POST', headers: aiHeaders(), body: JSON.stringify({ lead: current, offering, persona, senderName }) });
          const data = await res.json().catch(() => ({})) as { lead?: Lead; model?: string; web?: boolean; detail?: string };
          if (!res.ok || !data.lead) { if (res.status === 401 || res.status === 402) stop = data.detail || 'The AI key was rejected.'; throw new Error(data.detail || `Research answered ${res.status}.`); }
          const next = data.lead;
          setLeads(ls => ls.map(l => (l.id === next.id ? { ...next, stage: l.stage, sentAt: l.sentAt, email: l.stage === 'drafted' ? next.email : l.email } : l)));
          log(`${next.company.name}: score ${current.score} → ${next.score} (${next.tier}) from ${shortModel(data.model || '')}${data.web ? ' with web search' : ''}. ${next.why}`, next.tier === 'Hot' ? 'good' : 'info', next.id);
        } catch (e) {
          log(`${target.company.name}: AI research failed. ${e instanceof Error ? e.message : ''}`, 'warn', target.id);
        } finally {
          done++; setAiProgress({ done, total: targets.length }); setAiBusy(b => b.filter(id => id !== target.id));
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setAiProgress(null);
    if (stop) { setToast(stop); log(stop, 'warn'); } else log(`AI research finished on ${done} account${done > 1 ? 's' : ''}`, 'good');
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    if (!question.trim() || asking) return;
    if (!leads.length) { setToast('Run Outbound first'); return; }
    if (!aiReady) { setSetupOpen(true); setToast('Add an OpenRouter key in Setup to ask the brain'); return; }
    setAsking(true);
    try {
      const res = await fetch('/api/cipher/ask', { method: 'POST', headers: aiHeaders(), body: JSON.stringify({ question, offering, persona, leads: ranked.map(l => ({ ticker: l.id, name: l.company.name, score: l.score, tier: l.tier, stage: stageLabel(l.stage), why: l.why, signals: l.signals.map(x => `${x.kind}: ${x.headline}`) })) }) });
      const data = await res.json().catch(() => ({})) as { answer?: string; tickers?: string[]; model?: string; detail?: string };
      if (!res.ok || !data.answer) throw new Error(data.detail || `The brain answered ${res.status}.`);
      setAnswer({ text: data.answer, tickers: data.tickers ?? [], model: data.model || '' });
      log(`Asked the brain: ${question.trim()}`);
    } catch (e) {
      setAnswer({ text: e instanceof Error ? e.message : 'The brain could not answer.', tickers: [], model: '', error: true });
    } finally { setAsking(false); }
  }

  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (running) return;
    setRunning(true); setError(''); setLeads([]); setSelected(null); setFinishedAt(null); setScanning([]); setAnswer(null); if (view === 'pipeline') setView('brain');
    const got: Lead[] = []; let completed = false;
    setSteps([{ type: 'step', at: new Date().toISOString(), text: `Run started for ${customTickers.length ? 'a custom list' : market.label}` }]);
    try {
      const res = await fetch('/api/cipher/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketId, offering, persona, senderName, tickers: customTickers }) });
      if (!res.ok || !res.body) throw new Error(`The run service answered ${res.status}. Try again in a moment.`);
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as RunEvent;
          if (ev.type === 'step') { setSteps(s => [...s, ev]); if (ev.ticker && ev.text.startsWith('Scanning')) setScanning(s => [...s, ev.ticker!]); }
          else if (ev.type === 'lead') { got.push(ev.lead); setLeads(l => [...l.filter(x => x.id !== ev.lead.id), ev.lead]); }
          else { setFinishedAt(ev.at); completed = true; }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The run stopped before finishing.';
      setError(message); log(`Run stopped: ${message}`, 'warn');
    } finally { setRunning(false); setScanning([]); }
    if (completed && aiReady && got.length) void research([...got].sort((a, b) => b.score - a.score));
    else if (completed && !aiReady) log('Add an OpenRouter key in Setup to have AI research every account on the live web.');
  }

  const update = (id: string, patch: Partial<Lead>) => setLeads(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  function move(l: Lead, stage: Stage) {
    update(l.id, { stage, sentAt: stage === 'sent' ? new Date().toISOString() : l.sentAt });
    log(`${l.company.name} moved to ${stageLabel(stage)}`, stage === 'meeting' ? 'good' : 'info', l.id);
  }

  async function launch(targets: Lead[]) {
    if (!targets.length) return;
    if (webhook.trim()) {
      const payload = { source: 'cipher', persona, offering, leads: targets.map(l => ({ company: l.company.name, ticker: l.company.ticker, domain: l.company.domain, score: l.score, tier: l.tier, why: l.why, subject: l.email.subject, body: l.email.body, sequence: l.sequence })) };
      let detail = 'Your sending tool could not be reached.';
      try {
        const res = await fetch('/api/cipher/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhook: webhook.trim(), payload }) });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; detail?: string };
        if (!res.ok || !data.ok) { detail = data.detail || detail; throw new Error(detail); }
        log(`Sent ${targets.length} sequence${targets.length > 1 ? 's' : ''} to your sending tool`, 'good');
      } catch {
        log(`Not sent: ${detail} Check the webhook in Setup.`, 'warn');
        setToast('Not sent. Check the webhook in Setup.'); return;
      }
    } else log(`Started ${targets.length} sequence${targets.length > 1 ? 's' : ''}. Add a webhook in Setup to send through your own tool.`, 'good');
    const now = new Date().toISOString();
    setLeads(ls => ls.map(l => (targets.some(t => t.id === l.id) ? { ...l, stage: 'sent', sentAt: now } : l)));
    setToast(`${targets.length} sequence${targets.length > 1 ? 's' : ''} started`);
  }

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([leadsToCsv(ranked)], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `cipher-${marketId}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    log(`Exported ${ranked.length} accounts to CSV`);
  }

  async function copyEmail(l: Lead) {
    try { await navigator.clipboard.writeText(`Subject: ${l.email.subject}\n\n${l.email.body}`); setToast('Email copied'); }
    catch { setToast('Copy blocked. Select the text in the draft instead.'); }
  }

  const status = running ? `Scanning ${leads.length} of ${territory.length}` : finishedAt ? `Last run ${new Date(finishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : `${territory.length} accounts queued`;

  return (
    <div className="cipher">
      <header className="cx-toolbar">
        <a className="cx-word" href="/cipher"><span aria-hidden="true"><BinaryLens className="cx-mark" cols={15} rows={7} /></span>Cipher</a>
        <nav className="cx-nav" aria-label="Cipher">
          <button type="button" onClick={() => setSetupOpen(v => !v)} aria-expanded={setupOpen} aria-controls="cx-setup">Setup</button>
          <button type="button" onClick={exportCsv} disabled={!leads.length}>Export CSV</button>
          <a href="/">Workspace</a>
        </nav>
      </header>

      <section className="cx-hero">
        <BinaryLens className="cx-lens" active={running} label="Cipher" />
        <h1>Territory Pulse</h1>
        <p>Find the companies worth your team&rsquo;s time, reach the right buyer first, and see every step Cipher takes.</p>
        <form className="cx-command" onSubmit={run}>
          <div className="cx-segmented" role="radiogroup" aria-label="Territory">
            {MARKETS.map(m => (
              <label key={m.id} className={m.id === marketId && !customTickers.length ? 'on' : ''}>
                <input type="radio" name="territory" value={m.id} checked={m.id === marketId && !customTickers.length} disabled={running} onChange={() => { setMarketId(m.id); setTickers(''); }} />
                <span><span className="full">{m.label}</span><span className="short">{m.short}</span></span>
              </label>
            ))}
          </div>
          <div className="cx-group">
            <label className="cx-field" htmlFor="cx-offer"><span>You sell</span><input id="cx-offer" value={offering} onChange={e => setOffering(e.target.value)} disabled={running} required /></label>
            <label className="cx-field" htmlFor="cx-persona"><span>Buyer</span><select id="cx-persona" value={persona} onChange={e => setPersona(e.target.value)} disabled={running}>{PERSONAS.map(p => <option key={p}>{p}</option>)}</select></label>
          </div>
          {setupOpen ? (
            <div className="cx-group" id="cx-setup">
              <label className="cx-field" htmlFor="cx-sender"><span>Sign as</span><input id="cx-sender" value={senderName} placeholder="Alex, Cipher" onChange={e => setSenderName(e.target.value)} /></label>
              <label className="cx-field" htmlFor="cx-tickers"><span>Own list</span><input id="cx-tickers" value={tickers} placeholder="Tickers, e.g. HOOD, SOFI, NET" onChange={e => setTickers(e.target.value)} disabled={running} /></label>
              <label className="cx-field" htmlFor="cx-orkey"><span>AI key</span><input id="cx-orkey" type="password" autoComplete="off" spellCheck={false} value={orKey} placeholder={serverAi ? 'Using the server model gateway (optional OpenRouter key)' : 'OpenRouter key, kept in this browser'} onChange={e => setOrKey(e.target.value)} /></label>
              <label className="cx-field" htmlFor="cx-hook"><span>Send via</span><input id="cx-hook" type="url" value={webhook} placeholder="Webhook from Zapier, Make, Clay or Base44" onChange={e => setWebhook(e.target.value)} /></label>
            </div>
          ) : null}
          <button className="cx-run" type="submit" disabled={running || !offering.trim()}>{running ? 'Running…' : 'Run Outbound'}</button>
          <div className="cx-progress">
            <div className="cx-track" aria-hidden="true"><span style={{ width: `${territory.length ? Math.round(leads.length / territory.length * 100) : 0}%` }} /></div>
            <span className={running ? 'cx-status live' : 'cx-status'} role="status">{status}</span>
          </div>
        </form>
      </section>

      {error ? <p className="cx-error" role="alert">{error}</p> : null}

      <main className="cx-desk">
        <section className="cx-board" aria-label="Accounts">
          <div className="cx-board-head">
            <div className="cx-tabs" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={view === 'brain'} onClick={() => setView('brain')}>Brain</button>
              <button type="button" role="tab" aria-selected={view === 'accounts'} onClick={() => setView('accounts')}>Accounts</button>
              <button type="button" role="tab" aria-selected={view === 'pipeline'} onClick={() => setView('pipeline')}>Pipeline</button>
            </div>
            <dl className="cx-stats">
              <div><dt>Hot</dt><dd>{count('Hot')}</dd></div>
              <div><dt>Warm</dt><dd>{count('Warm')}</dd></div>
              <div><dt>Signals</dt><dd>{leads.reduce((n, l) => n + l.signals.length, 0)}</dd></div>
              <div><dt>In sequence</dt><dd>{launched}</dd></div>
              <div><dt>Meetings</dt><dd>{meetings}</dd></div>
            </dl>
          </div>

          {view !== 'pipeline' ? (
            <>
              <div className="cx-tools">
                <div className="cx-filter" role="group" aria-label="Filter by tier">
                  {(['All', 'Hot', 'Warm', 'Watch'] as const).map(f => <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
                </div>
                <div className="cx-tools-right">
                  <button type="button" className="cx-btn cx-ai-btn" disabled={running || !!aiProgress || !leads.length} onClick={() => void research(ranked)}>
                    {aiProgress ? `Researching ${aiProgress.done}/${aiProgress.total}…` : 'Research with AI'}
                  </button>
                  <button type="button" className="cx-act" disabled={running || !readyHot.length} onClick={() => void launch(readyHot)}>
                    {readyHot.length ? `Start ${readyHot.length} hot sequence${readyHot.length > 1 ? 's' : ''}` : count('Hot') ? 'Hot sequences started' : 'Start hot sequences'}
                  </button>
                </div>
              </div>
              {view === 'brain' ? (
                <>
                  <ProspectBrain leads={leads} running={running} selected={selected} filter={filter} onSelect={setSelected} highlight={answer?.tickers ?? []} busy={aiBusy} />
                  <form className="cx-ask" onSubmit={ask}>
                    <label className="cx-sr" htmlFor="cx-question">Ask the brain</label>
                    <input id="cx-question" value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask the brain about these accounts" maxLength={500} />
                    <button type="submit" className="cx-act" disabled={asking || !question.trim()}>{asking ? 'Thinking…' : 'Ask'}</button>
                  </form>
                  {answer ? (
                    <div className={`cx-answer${answer.error ? ' error' : ''}`} role="status">
                      <p>{answer.text}</p>
                      {answer.tickers.length ? <div className="cx-answer-chips">{answer.tickers.map(t => <button type="button" key={t} className="cx-tk" onClick={() => setSelected(t)}>{t}</button>)}</div> : null}
                      {answer.model ? <small>Answered by {shortModel(answer.model)} from this territory&rsquo;s accounts</small> : null}
                    </div>
                  ) : null}
                </>
              ) : (
              <div className="cx-table" role="table" aria-label="Ranked accounts">
                <div className="cx-row cx-th" role="row">
                  <span role="columnheader">#</span><span role="columnheader">Account</span>
                  {KINDS.map(k => <span role="columnheader" key={k.id} className="cx-sig-h">{k.label}</span>)}
                  <span role="columnheader" className="num">Score</span><span role="columnheader">Status</span>
                </div>
                {visible.map((l, i) => (
                  <button type="button" role="row" key={l.id} className={`cx-row ${selected === l.id ? 'sel' : ''}`} onClick={() => setSelected(l.id)}>
                    <span className="cx-rank">{filter === 'All' ? i + 1 : ranked.indexOf(l) + 1}</span>
                    <span className="cx-acct"><b>{l.company.name}</b><small>{l.company.ticker} · {l.company.hq}</small></span>
                    {KINDS.map(k => {
                      const s = l.signals.find(x => x.kind === k.id);
                      return (
                        <span key={k.id} className={`cx-cell${s ? (s.strength / SIGNAL_MAX[k.id] >= .85 ? ' hit strong' : ' hit') : ''}`} style={s ? { ['--heat' as string]: String(Math.max(.18, s.strength / SIGNAL_MAX[k.id])) } : undefined} title={s ? `${s.headline} (${s.source === 'live' ? 'live' : s.source === 'ai' ? 'AI research' : 'demo estimate'})` : `No ${k.label.toLowerCase()} signal`}>
                          <em>{k.label}</em>{s ? s.metric : '—'}{s?.source === 'live' ? <i aria-label="live" /> : s?.source === 'ai' ? <i className="ai" aria-label="AI research" /> : null}
                        </span>
                      );
                    })}
                    <span className="cx-score num"><b>{l.score}</b><span className={`cx-tier ${l.tier.toLowerCase()}`}>{l.tier}</span></span>
                    <span className={`cx-stage ${l.stage}`}>{aiBusy.includes(l.id) ? 'Researching…' : stageLabel(l.stage)}</span>
                  </button>
                ))}
                {pending.map(c => (
                  <div role="row" key={c.ticker} className="cx-row pending">
                    <span className="cx-rank">·</span>
                    <span className="cx-acct"><b>{c.name}</b><small>{c.ticker} · {scanning.includes(c.ticker) ? 'checking filings and job boards' : 'queued'}</small></span>
                    {KINDS.map(k => <span key={k.id} className="cx-cell"><em>{k.label}</em></span>)}
                    <span className="cx-score num" /><span className="cx-stage" />
                  </div>
                ))}
                {!rows.length && !running ? territory.map((c, i) => (
                  <div role="row" key={c.ticker} className="cx-row idle">
                    <span className="cx-rank">{i + 1}</span>
                    <span className="cx-acct"><b>{c.name}</b><small>{c.ticker} · {c.hq}</small></span>
                    {KINDS.map(k => <span key={k.id} className="cx-cell"><em>{k.label}</em></span>)}
                    <span className="cx-score num" /><span className="cx-stage">Not scanned</span>
                  </div>
                )) : null}
              </div>
              )}
            </>
          ) : (
            <div className="cx-pipe">
              {STAGES.map(stage => {
                const items = ranked.filter(l => l.stage === stage.id);
                return (
                  <section key={stage.id} className="cx-lane" aria-label={stage.label}>
                    <h3><span>{stage.label}</span><span className="num">{items.length}</span></h3>
                    {items.length ? items.map(l => (
                      <button type="button" key={l.id} className="cx-ticket" onClick={() => setSelected(l.id)}>
                        <span className="row"><b>{l.company.name}</b><span className={`cx-tier ${l.tier.toLowerCase()}`}>{l.score}</span></span>
                        <small>{l.why}</small>
                        <small className="next">Next: {l.sequence.find(t => t.day > 0)?.channel} on {l.sequence.find(t => t.day > 0)?.due}</small>
                      </button>
                    )) : <p className="cx-lane-empty">Nothing here yet</p>}
                  </section>
                );
              })}
            </div>
          )}
        </section>

        <aside className="cx-log" aria-label="Run log">
          <div className="cx-log-head"><span className="cx-label">Run log</span><span className="cx-status">{steps.length} entries</span></div>
          <ol ref={logRef} aria-live="polite">
            {steps.length ? steps.map((s, i) => (
              <li key={i} className={s.tone || 'info'}>
                <time>{clock(s.at)}</time>
                <span>{s.ticker ? <button type="button" className="cx-tk" onClick={() => byId.has(s.ticker!) && setSelected(s.ticker!)}>{s.ticker}</button> : null}{s.text}</span>
              </li>
            )) : <li className="info empty"><span>Each source Cipher checks, every score, draft and send is written here as it happens.</span></li>}
          </ol>
        </aside>
      </main>

      {lead ? (
        <div className="cx-scrim" onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <article className="cx-dossier" role="dialog" aria-modal="true" aria-labelledby="cx-dossier-title">
            <header>
              <div>
                <p className="cx-label">{lead.company.ticker}{lead.company.domain ? ` · ${lead.company.domain}` : ''} · {lead.company.hq}</p>
                <h2 id="cx-dossier-title">{lead.company.name}</h2>
              </div>
              <div className="cx-dossier-score"><b className="num">{lead.score}</b><span className={`cx-tier ${lead.tier.toLowerCase()}`}>{lead.tier}</span></div>
              <button type="button" className="cx-close" aria-label="Close" autoFocus onClick={() => setSelected(null)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
            </header>

            <p className="cx-why"><span className="cx-label">Why now</span>{lead.why}</p>
            {lead.ai ? <p className="cx-ai-note">Researched by {shortModel(lead.ai.model)}{lead.ai.web ? ' with live web search' : ''} · {new Date(lead.ai.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p> : null}

            <h3 className="cx-label">Evidence</h3>
            <ul className="cx-evidence">
              {lead.signals.length ? lead.signals.map(s => (
                <li key={s.kind}>
                  <div className="row">
                    <span className="k">{KINDS.find(k => k.id === s.kind)?.label}</span>
                    <b>{s.headline}</b>
                    <span className={`src ${s.source}`}>{s.source === 'live' ? 'Live' : s.source === 'ai' ? 'AI research' : 'Demo estimate'}</span>
                    <span className="pts num">+{s.strength}</span>
                  </div>
                  <ul>{s.evidence.map((ev, i) => <li key={i}>{ev.url ? <a href={ev.url} target="_blank" rel="noreferrer">{ev.label}</a> : ev.label}{ev.date && !ev.label.includes(ev.date) ? <span> · {ev.date}</span> : null}</li>)}</ul>
                </li>
              )) : <li>No strong signals yet. Keep this account on watch.</li>}
            </ul>

            <h3 className="cx-label">Buyer</h3>
            <div className="cx-buyer">
              <span>{lead.buyer.name ? <><b>{lead.buyer.name}</b>, {lead.buyer.title || lead.buyer.persona}{lead.buyer.source ? <> · <a className="cx-inline" href={lead.buyer.source} target="_blank" rel="noreferrer">source</a></> : null}</> : <><b>{lead.buyer.persona}</b>, {lead.company.name}</>}</span>
              <a href={lead.buyer.linkedin} target="_blank" rel="noreferrer">Search LinkedIn</a>
              <a href={lead.buyer.apollo} target="_blank" rel="noreferrer">Search Apollo</a>
            </div>

            <h3 className="cx-label">First email</h3>
            <label className="cx-sr" htmlFor="cx-subject">Subject</label>
            <input id="cx-subject" className="cx-subject" value={lead.email.subject} onChange={e => update(lead.id, { email: { ...lead.email, subject: e.target.value } })} />
            <label className="cx-sr" htmlFor="cx-body">Email body</label>
            <textarea id="cx-body" className="cx-body" value={lead.email.body} rows={11} onChange={e => update(lead.id, { email: { ...lead.email, body: e.target.value } })} />

            <h3 className="cx-label">Sequence</h3>
            <ol className="cx-seq">
              {lead.sequence.map(t => (
                <li key={t.day} className={lead.stage !== 'drafted' && t.day === 0 ? 'done' : ''}>
                  <span className="d num">Day {t.day}</span><span className="ch">{t.channel}</span><span className="a">{t.action}</span><time className="num">{t.due}</time>
                </li>
              ))}
            </ol>

            <footer>
              <button type="button" className="cx-btn" disabled={!!aiProgress} onClick={() => void research([lead])}>{aiBusy.includes(lead.id) ? 'Researching…' : lead.ai ? 'Research again' : 'Research with AI'}</button>
              {lead.stage === 'drafted' ? <button type="button" className="cx-act" onClick={() => void launch([lead])}>Start sequence</button> : null}
              {lead.stage === 'drafted' ? <a className="cx-btn" href={`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(lead.email.subject)}&body=${encodeURIComponent(lead.email.body)}`} target="_blank" rel="noreferrer" onClick={() => move(lead, 'sent')}>Open in Gmail</a> : null}
              <button type="button" className="cx-btn" onClick={() => void copyEmail(lead)}>Copy email</button>
              {lead.stage === 'sent' ? <button type="button" className="cx-btn" onClick={() => move(lead, 'replied')}>Mark replied</button> : null}
              {lead.stage === 'sent' || lead.stage === 'replied' ? <button type="button" className="cx-act" onClick={() => move(lead, 'meeting')}>Meeting booked</button> : null}
              {lead.sentAt ? <span className="cx-status">Started {new Date(lead.sentAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> : null}
            </footer>
          </article>
        </div>
      ) : null}
      {toast ? <div className="cx-toast" role="status">{toast}</div> : null}
    </div>
  );
}
