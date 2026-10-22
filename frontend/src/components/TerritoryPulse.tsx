'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { buildProspects, exportProspects, Prospect } from '../lib/territory-pulse';
import './territory-pulse.css';

type Activity = { id: number; time: string; text: string };
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function TerritoryPulse() {
  const [market, setMarket] = useState('B2B software companies');
  const [offer, setOffer] = useState('Help revenue teams turn buying signals into thoughtful outreach');
  const [rows, setRows] = useState<Prospect[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'prospects' | 'activity'>('prospects');
  const [events, setEvents] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  const sequence = useRef(0);
  const detail = rows.find(row => row.id === selected);
  const filtered = rows.filter(row => `${row.name} ${row.sector} ${row.signal}`.toLowerCase().includes(query.toLowerCase()));
  function record(text: string) { setEvents(old => [{ id: ++sequence.current, time: clock(), text }, ...old]); }
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const next = buildProspects(market, offer);
      setRows(next); setSelected(next[0]?.id || ''); setQuery(''); setTab('prospects');
      record(`Prepared ${next.length} fictional demo accounts for “${market.trim()}”. No live research performed.`);
      record(`Ranked sample scenarios and prepared ${next.length} editable outreach drafts. No contacts verified or messages sent.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare this list. Check your inputs and try again.'); }
    finally { running.current = false; setBusy(false); }
  }
  function updateDraft(value: string) { setRows(old => old.map(row => row.id === selected ? { ...row, draft: value, status: 'new' } : row)); }
  function review() {
    if (!detail || detail.status === 'reviewed') return;
    setRows(old => old.map(row => row.id === selected ? { ...row, status: 'reviewed' } : row));
    record(`Reviewed the draft for ${detail.name}. Sending remains blocked: recipient and live evidence are unverified.`);
    setNotice('Draft reviewed. Verify a real contact and source before any outreach.');
  }
  function download() {
    const url = URL.createObjectURL(new Blob([exportProspects(rows)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'territory-pulse-demo.csv'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    record(`Exported ${rows.length} demo accounts and drafts to CSV. Nothing was sent.`);
    setNotice('CSV exported. All rows are labeled as demo data.');
  }
  async function copy() {
    if (!detail) return;
    try { await navigator.clipboard.writeText(detail.draft); setNotice('Draft copied. Nothing was sent.'); record(`Copied ${detail.name} draft for manual review.`); }
    catch { setNotice('Clipboard unavailable. Select and copy the draft text below.'); }
  }
  return <div className="pulse-app">
    <aside className="pulse-sidebar">
      <a className="pulse-brand" href="/?workspace=1" aria-label="Cipher — open agent workspace"><span className="pulse-logo-frame"><Image src="/cipher-logo.png" alt="Cipher" width={184} height={184} priority unoptimized/></span></a>
      <nav aria-label="Prospecting navigation"><a className="pulse-current" href="#territory">Territory pulse <span>20</span></a><a href="/?workspace=1">Agent workspace <span aria-hidden="true">↗</span></a></nav>
      <div className="pulse-sidebar-foot"><span className="pulse-dot"/> Demo workspace<p>Review first. Send with intent.</p></div>
    </aside>
    <main id="territory" className="pulse-main">
      <header className="pulse-top"><span>Territory pulse</span><a href="/?workspace=1">Open agent workspace <span aria-hidden="true">↗</span></a></header>
      <div className="pulse-content">
        <div className="pulse-intro"><div><h1>Find your next<br/>right customer.</h1><p>Turn a market into a focused list, a reason to reach out,<br className="pulse-desktop-break"/> and a next step your team can actually take.</p></div><span className="pulse-demo-tag">Demo data · No live sending</span></div>
        <form className="pulse-brief" onSubmit={event => void run(event)}>
          <label>Target market<input value={market} onChange={e => setMarket(e.target.value)} maxLength={120} required placeholder="e.g. UK fintech companies" disabled={busy}/></label>
          <label>What you sell<input value={offer} onChange={e => setOffer(e.target.value)} maxLength={500} required placeholder="The outcome you help customers achieve" disabled={busy}/></label>
          <button className="pulse-primary" disabled={busy} type="submit">{busy ? 'Preparing demo…' : rows.length ? 'Refresh demo prospects' : 'Find 20 demo prospects'}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button>
        </form>
        <p className="pulse-disclosure">This working demo uses 20 fictional companies and illustrative signals. It does not research real companies, verify contacts, or send messages. Scores are sample rankings, not buying evidence.</p>
        {error && <p className="pulse-error" role="alert">{error}</p>}
        <div className="pulse-section-bar"><div className="pulse-tabs" role="group" aria-label="Workspace view"><button aria-pressed={tab === 'prospects'} onClick={() => setTab('prospects')}>Prospects <span>{rows.length}</span></button><button aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>Activity <span>{events.length}</span></button></div>{rows.length > 0 && <button className="pulse-export" onClick={download}>Export CSV <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg></button>}</div>
        <div role="status" className="pulse-notice">{notice}</div>
        {tab === 'activity' ? <section className="pulse-activity" aria-label="Activity timeline"><h2>A record of every step.</h2><p>These are actions taken in this browser session. Research and delivery are never implied.</p>{events.length ? <ol>{events.map(event => <li key={event.id}><time>{event.time}</time><p>{event.text}</p></li>)}</ol> : <p>No activity yet. Prepare your first demo list above.</p>}</section> : !rows.length ? <section className="pulse-empty"><svg aria-hidden="true" viewBox="0 0 64 64"><path d="M8 44h48M13 36l12-12 11 6 15-17M42 13h9v9"/></svg><h2>A smaller list. A better first move.</h2><p>Start with a market and the outcome you sell.<br/>Then explore the ranking, review a draft, and export your next steps.</p><div><span>Ranked accounts</span><span>Evidence trail</span><span>Editable outreach</span></div></section> : <div className="pulse-workbench">
          <section className="pulse-prospects" aria-label="Ranked demo prospects"><div className="pulse-list-heading"><div><h2>Your focused twenty</h2><p>{rows.length} demo accounts · {rows.filter(row => row.status === 'reviewed').length} drafts reviewed · 0 sent</p></div><label className="pulse-search"><span className="visually-hidden">Filter prospects</span><input type="search" placeholder="Filter prospects…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
            <div className="pulse-table-wrap"><table><thead><tr><th>Company</th><th>Illustrative signal</th><th>Sample score</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id} className={detail?.id === row.id ? 'pulse-selected' : ''}><td><button className="pulse-company" aria-pressed={detail?.id === row.id} onClick={() => { setSelected(row.id); setNotice(''); }}><span className="pulse-company-mark" aria-hidden="true">{row.name.slice(0, 1)}</span><span><strong>{row.name}</strong><small>{row.sector}</small></span></button></td><td><span className="pulse-signal">{row.signal}</span><small>Demo fixture · 22 Oct 2026</small></td><td><span className="pulse-score">{row.score}</span><small>{row.status === 'reviewed' ? 'Draft reviewed' : 'Needs review'}</small></td></tr>)}</tbody></table></div>{!filtered.length && <p className="pulse-no-results">No matches. Try another company or clear your filter.</p>}
          </section>
          {detail && <aside className="pulse-detail" aria-label="Selected prospect detail"><div className="pulse-detail-title"><span className="pulse-company-mark">{detail.name.slice(0, 1)}</span><div><h2>{detail.name}</h2><p>Fictional demo company</p></div></div><div className="pulse-evidence"><h3>Why this account?</h3><p>{detail.signal}</p><div><span>Source</span><strong>Demo fixture · {detail.source.date}</strong></div><p className="pulse-source-warning">Illustrative scenario. No live source has been verified. Research evidence is required before acting.</p></div><div className="pulse-buyer"><h3>Who to speak with</h3><strong>{detail.buyerRole}</strong><p>Contact needed · No recipient verified</p></div><div className="pulse-draft"><div><h3>Start a conversation</h3><button onClick={() => void copy()}>Copy draft</button></div><label className="visually-hidden" htmlFor="pulse-draft">Outreach draft</label><textarea id="pulse-draft" value={detail.draft} onChange={e => updateDraft(e.target.value)} rows={9}/><button className="pulse-review" disabled={detail.status === 'reviewed'} onClick={review}>{detail.status === 'reviewed' ? 'Reviewed — edit to revise' : 'Mark draft reviewed'}</button></div><div className="pulse-next"><h3>Before this can be sent</h3><ol><li>Verify a dated, relevant buying signal.</li><li>Find and verify the right recipient.</li><li>Review the message and approve sending.</li></ol><button disabled>Sending not enabled</button><p>No sending integration is active in this demo.</p></div></aside>}
        </div>}
      </div>
    </main>
  </div>;
}
