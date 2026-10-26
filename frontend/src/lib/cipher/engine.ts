import type { Company } from './markets';

export type SignalKind = 'hiring' | 'raising' | 'spending' | 'news';
export type Source = 'live' | 'snapshot' | 'ai';
export interface Evidence { label: string; url?: string; date?: string }
export interface Signal { kind: SignalKind; strength: number; metric: string; headline: string; source: Source; evidence: Evidence[] }
export type Stage = 'found' | 'researched' | 'drafted' | 'sent' | 'manual-sent' | 'replied' | 'meeting';
export interface Touch { day: number; channel: 'Email' | 'LinkedIn' | 'Call'; action: string; due: string }
export interface Lead {
  id: string; company: Company; signals: Signal[]; score: number; tier: 'Hot' | 'Warm' | 'Watch';
  why: string; buyer: { persona: string; linkedin: string; apollo: string; name?: string; title?: string; source?: string };
  email: { subject: string; body: string }; sequence: Touch[]; stage: Stage; sentAt?: string; manualSentAt?: string;
  ai?: { model: string; web: boolean; at: string };
}
export interface RunConfig { marketId: string; offering: string; persona: string; senderName: string; tickers?: string[] }
export type RunEvent =
  | { type: 'step'; at: string; ticker?: string; text: string; tone?: 'info' | 'good' | 'warn' }
  | { type: 'lead'; at: string; lead: Lead }
  | { type: 'done'; at: string; summary: { scanned: number; hot: number; warm: number; signals: number; liveSources: number } };

export interface RawSignals {
  jobs?: { total: number; gtm: number; samples: Evidence[] };
  filings?: { recent90: number; raising: Evidence[]; material: Evidence[]; spend: Evidence[] };
}

const GTM = /(sales|account exec|sdr|bdr|business development|revenue|revops|growth|marketing|demand gen|partnerships|customer success|solutions)/i;
export const isGtmRole = (title: string) => GTM.test(title);

export function buildSignals(company: Company, raw: RawSignals): Signal[] {
  const s = company.snapshot; const signals: Signal[] = [];
  const jobs = raw.jobs; const filings = raw.filings;
  const open = jobs?.total ?? s.openRoles, gtm = jobs?.gtm ?? s.gtmRoles, jobSource: Source = jobs ? 'live' : 'snapshot';
  if (open > 0) signals.push({
    kind: 'hiring', source: jobSource, strength: Math.min(40, Math.round(open / 12 + gtm / 2.5)), metric: String(open),
    headline: `${open} open roles${gtm ? ` · ${gtm} in go-to-market` : ''}`,
    evidence: jobs?.samples.length ? jobs.samples : [{ label: `${open} postings (demo estimate)`, url: `https://www.google.com/search?q=${encodeURIComponent(company.name + ' careers')}` }],
  });
  const raising = filings ? filings.raising.length > 0 : s.raisedRecently;
  if (raising) signals.push({
    kind: 'raising', source: filings ? 'live' : 'snapshot', strength: 25, metric: filings?.raising[0]?.label.split(' ')[0] ?? 'Yes',
    headline: filings ? `${filings.raising.length} capital-markets filing${filings.raising.length > 1 ? 's' : ''} in 180 days` : 'Recent capital raise (demo estimate)',
    evidence: filings?.raising.length ? filings.raising.slice(0, 3) : [{ label: 'SEC filings index', url: edgarUrl(company.ticker) }],
  });
  const spendUp = filings ? filings.spend.length > 0 : s.capexTrend === 'up';
  if (spendUp) signals.push({
    kind: 'spending', source: filings ? 'live' : 'snapshot', strength: 18, metric: filings?.spend[0]?.label.split(' ')[0] ?? 'Up',
    headline: filings ? `${filings.spend.length} earnings/annual report${filings.spend.length > 1 ? 's' : ''} this half` : 'Operating spend trending up (demo estimate)',
    evidence: filings?.spend.length ? filings.spend.slice(0, 2) : [{ label: 'Financial filings', url: edgarUrl(company.ticker) }],
  });
  const material = filings ? filings.material.length : s.filings90d;
  if (material >= 3) signals.push({
    kind: 'news', source: filings ? 'live' : 'snapshot', strength: Math.min(17, material * 2), metric: `${material}× 8-K`,
    headline: `${material} material events (8-K) in 90 days`,
    evidence: filings?.material.length ? filings.material.slice(0, 3) : [{ label: '8-K filings', url: edgarUrl(company.ticker) }],
  });
  return signals;
}

export const SIGNAL_MAX: Record<SignalKind, number> = { hiring: 40, raising: 25, spending: 18, news: 17 };

export const edgarUrl = (ticker: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=&dateb=&owner=include&count=40`;

export function scoreLead(signals: Signal[]) {
  const score = Math.min(100, signals.reduce((sum, sig) => sum + sig.strength, 0));
  const tier: Lead['tier'] = score >= 70 ? 'Hot' : score >= 45 ? 'Warm' : 'Watch';
  return { score, tier };
}

const addDays = (start: Date, days: number) => { const d = new Date(start); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export function buildLead(company: Company, signals: Signal[], cfg: RunConfig, now = new Date()): Lead {
  const { score, tier } = scoreLead(signals);
  const top = [...signals].sort((a, b) => b.strength - a.strength);
  const hook = top[0];
  const hiring = signals.find(s => s.kind === 'hiring');
  const raising = signals.find(s => s.kind === 'raising');
  const why = top.length ? top.slice(0, 2).map(s => s.headline).join(' + ') : 'No strong buying signal yet';
  const opener = !hook ? `I've been following ${company.name} and had a quick idea.`
    : hook.kind === 'hiring' ? `Noticed ${company.name} has ${hiring?.headline.replace(' · ', ', with ')} right now — that's a lot of pipeline to feed.`
    : hook.kind === 'raising' ? `Saw ${company.name}'s recent capital-markets activity — teams usually get a new growth target right after.`
    : hook.kind === 'spending' ? `${company.name}'s latest filings point to continued investment in growth.`
    : `${company.name} has had a busy quarter of announcements — usually a sign priorities are shifting.`;
  const subject = hook?.kind === 'hiring' ? `${company.name}'s ${hiring?.headline.split(' ')[0]} open roles` : hook?.kind === 'raising' ? `After the raise at ${company.name}` : `Idea for ${company.name}'s ${cfg.persona.replace(/^(VP of |VP |Head of |Chief )/, '').toLowerCase()} team`;
  const body = [`Hi {{first_name}},`, '', opener, '',
    `We help teams like yours with ${cfg.offering}. ${raising ? 'Fresh capital plus a hiring push is exactly when this pays back fastest.' : 'It usually shows up in pipeline within the first month.'}`, '',
    `Worth a 15-minute look next week? Happy to share what's working for similar teams.`, '',
    `— ${cfg.senderName || 'The Cypher team'}`].join('\n');
  const query = encodeURIComponent(`${cfg.persona} ${company.name}`);
  return {
    id: company.ticker, company, signals, score, tier, why,
    buyer: { persona: cfg.persona, linkedin: `https://www.linkedin.com/search/results/people/?keywords=${query}`, apollo: `https://app.apollo.io/#/people?qKeywords=${query}` },
    email: { subject, body },
    sequence: [
      { day: 0, channel: 'Email', action: 'Signal-based intro email', due: addDays(now, 0) },
      { day: 2, channel: 'LinkedIn', action: `Connect with ${cfg.persona}, reference ${hook?.kind ?? 'company'} signal`, due: addDays(now, 2) },
      { day: 4, channel: 'Email', action: 'Follow-up with one proof point', due: addDays(now, 4) },
      { day: 7, channel: 'Call', action: 'Call + voicemail, book the meeting', due: addDays(now, 7) },
    ],
    stage: 'drafted',
  };
}

export function leadsToCsv(leads: Lead[]) {
  // Quoting alone does not stop spreadsheet formulas, so formula-leading cells get a ' prefix.
  const esc = (v: string | number) => { const t = String(v); const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(t) ? `'${t}` : t; return `"${safe.replace(/"/g, '""')}"`; };
  const rows = [['Company', 'Ticker', 'Domain', 'Score', 'Tier', 'Why now', 'Buyer persona', 'Subject', 'Body', 'Stage', 'Next touch'].map(esc).join(',')];
  for (const l of leads) rows.push([l.company.name, l.company.ticker, l.company.domain, l.score, l.tier, l.why, l.buyer.persona, l.email.subject, l.email.body, l.stage, `${l.sequence[1]?.channel} ${l.sequence[1]?.due}`].map(esc).join(','));
  return rows.join('\n');
}

// Model research (see app/api/cipher/research) folded back into a lead.
export interface Research {
  signals: Partial<Record<SignalKind, { level: number; detail: string; sources: Evidence[] }>>;
  buyer?: { name?: string; title?: string; source?: string };
  whyNow?: string;
  email?: { subject: string; body: string };
  citations?: Evidence[];
}
const KIND_ORDER: SignalKind[] = ['hiring', 'raising', 'spending', 'news'];
const LEVEL_WORD = ['None', 'Low', 'Med', 'High'];

export function applyResearch(lead: Lead, research: Research, meta: { model: string; web: boolean }, now = new Date()): Lead {
  const signals: Signal[] = [];
  const spare = [...(research.citations ?? [])];
  for (const kind of KIND_ORDER) {
    const existing = lead.signals.find(s => s.kind === kind);
    const found = research.signals[kind];
    if (existing?.source === 'live') { signals.push(found?.detail ? { ...existing, headline: `${existing.headline}. ${found.detail}`.slice(0, 220) } : existing); continue; }
    if (!found) { if (existing) signals.push(existing); continue; }
    const level = Math.max(0, Math.min(3, Math.round(found.level)));
    if (!level) continue;
    const evidence = found.sources.length ? found.sources.slice(0, 4) : spare.splice(0, 2);
    signals.push({ kind, source: 'ai', strength: Math.round(level / 3 * SIGNAL_MAX[kind]), metric: LEVEL_WORD[level], headline: found.detail.slice(0, 200) || `${LEVEL_WORD[level]} ${kind} signal`, evidence });
  }
  const { score, tier } = scoreLead(signals);
  const buyer = { ...lead.buyer, ...(research.buyer?.name ? { name: research.buyer.name, title: research.buyer.title || lead.buyer.persona, source: research.buyer.source } : {}) };
  const email = lead.stage === 'drafted' && research.email?.subject && research.email.body ? research.email : lead.email;
  const why = research.whyNow?.trim() || (signals.length ? [...signals].sort((a, b) => b.strength - a.strength).slice(0, 2).map(s => s.headline).join(' + ') : 'No strong buying signal found');
  return { ...lead, signals, score, tier, why: why.slice(0, 240), buyer, email, ai: { ...meta, at: now.toISOString() } };
}

// Account intelligence: Cypher's estimates derived from a lead's signals (no external data).
export interface Intel {
  dealSize: string; seats: number; window: string; confidence: 'High' | 'Medium' | 'Low'; fit: { label: string; points: number; max: number }[];
  committee: { role: string; title: string; why: string }[];
  play: { name: string; angle: string; talkTrack: string[]; objections: { objection: string; answer: string }[] };
  channel: string; timing: string;
}
const PLAYS: Record<SignalKind | 'none', { name: string; angle: string }> = {
  hiring: { name: 'Ramp new reps faster', angle: 'A hiring push means new reps who need pipeline from week one.' },
  raising: { name: 'Post-raise growth plan', angle: 'Fresh capital comes with a growth target the board will measure.' },
  spending: { name: 'Efficiency at scale', angle: 'Rising spend puts pressure on cost per meeting and rep productivity.' },
  news: { name: 'Change moment', angle: 'Announcements and leadership changes reopen priorities and budgets.' },
  none: { name: 'Stay close', angle: 'No trigger yet: stay visible so you are first when one appears.' },
};
const TIMEZONE: Record<string, string> = { CA: 'Pacific', WA: 'Pacific', OR: 'Pacific', MT: 'Mountain', AZ: 'Mountain', TX: 'Central', IL: 'Central', MN: 'Central' };

export function accountIntel(lead: Lead): Intel {
  const hiring = lead.signals.find(s => s.kind === 'hiring');
  const gtm = Number(hiring?.headline.match(/(\d+) in go-to-market/)?.[1] ?? 0);
  const open = Number(hiring?.metric.match(/^\d+$/) ? hiring.metric : 0) || gtm * 4;
  const seats = Math.max(10, Math.round((gtm || open / 4 || 12) * 1.5 / 5) * 5);
  const acv = seats * 1200;
  const fmt = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
  const sources = lead.signals.map(s => s.source);
  const confidence: Intel['confidence'] = sources.includes('live') ? 'High' : sources.includes('ai') ? 'Medium' : 'Low';
  const top = [...lead.signals].sort((a, b) => b.strength - a.strength)[0];
  const play = PLAYS[top?.kind ?? 'none'];
  const state = lead.company.hq.split(',').pop()?.trim() ?? '';
  const zone = TIMEZONE[state] ?? 'Eastern';
  const persona = lead.buyer.persona;
  const talkTrack = [
    play.angle,
    ...lead.signals.slice(0, 2).map(s => `Reference it: ${s.headline.split('.')[0].toLowerCase()}.`),
    `Ask how the ${persona.replace(/^(VP of |VP |Head of |Chief )/, '').toLowerCase()} team plans to hit this year's number with the current process.`,
  ].slice(0, 4);
  return {
    dealSize: `${fmt(acv * .8)}–${fmt(acv * 1.3)}`, seats,
    window: lead.tier === 'Hot' ? 'Next 30 days' : lead.tier === 'Warm' ? '30–90 days' : '90+ days',
    confidence,
    fit: (['hiring', 'raising', 'spending', 'news'] as SignalKind[]).map(kind => ({ label: kind === 'news' ? 'Momentum' : kind[0].toUpperCase() + kind.slice(1), points: lead.signals.find(s => s.kind === kind)?.strength ?? 0, max: SIGNAL_MAX[kind] })),
    committee: [
      { role: 'Economic buyer', title: persona, why: 'Owns the number and the budget' },
      { role: 'Champion', title: 'Head of Revenue Operations', why: 'Feels the pipeline pain day to day' },
      { role: 'Evaluator', title: 'Sales Systems / Enablement lead', why: 'Checks fit with the CRM and workflow' },
      { role: 'Approver', title: 'VP Finance', why: `Signs off on a ${fmt(acv)} line item` },
    ],
    play: {
      name: play.name, angle: play.angle, talkTrack,
      objections: [
        { objection: 'We already have a tool for this.', answer: 'Most teams do. Cypher sits on top and decides who to work first, so the tool you have gets better leads.' },
        { objection: lead.tier === 'Hot' ? 'Bad timing, we are mid-quarter.' : 'Not a priority this quarter.', answer: lead.tier === 'Hot' ? `That is the point: the ${top?.kind ?? 'current'} signal says the window is now.` : 'Fair. Can I send a two-line note when a trigger shows up?' },
        { objection: 'Send me something.', answer: `Happy to. One page on how teams like ${lead.company.name} used the ${play.name.toLowerCase()} play, then 15 minutes to see if it fits.` },
      ],
    },
    channel: lead.tier === 'Watch' ? 'LinkedIn first, then email' : 'Email first, LinkedIn on day 2',
    timing: `Tue–Thu, 8–10am ${zone}`,
  };
}
