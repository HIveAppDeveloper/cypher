import type { Company } from './markets';

export type SignalKind = 'hiring' | 'raising' | 'spending' | 'news';
export type Source = 'live' | 'snapshot';
export interface Evidence { label: string; url?: string; date?: string }
export interface Signal { kind: SignalKind; strength: number; metric: string; headline: string; source: Source; evidence: Evidence[] }
export type Stage = 'found' | 'researched' | 'drafted' | 'sent' | 'replied' | 'meeting';
export interface Touch { day: number; channel: 'Email' | 'LinkedIn' | 'Call'; action: string; due: string }
export interface Lead {
  id: string; company: Company; signals: Signal[]; score: number; tier: 'Hot' | 'Warm' | 'Watch';
  why: string; buyer: { persona: string; linkedin: string; apollo: string };
  email: { subject: string; body: string }; sequence: Touch[]; stage: Stage; sentAt?: string;
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
    `— ${cfg.senderName || 'The Cipher team'}`].join('\n');
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
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Company', 'Ticker', 'Domain', 'Score', 'Tier', 'Why now', 'Buyer persona', 'Subject', 'Body', 'Stage', 'Next touch'].map(esc).join(',')];
  for (const l of leads) rows.push([l.company.name, l.company.ticker, l.company.domain, l.score, l.tier, l.why, l.buyer.persona, l.email.subject, l.email.body, l.stage, `${l.sequence[1]?.channel} ${l.sequence[1]?.due}`].map(esc).join(','));
  return rows.join('\n');
}
