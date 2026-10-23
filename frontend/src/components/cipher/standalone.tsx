// Standalone entry for the shareable Cipher demo: runs the territory scan in the browser
// from built-in data (no server), so the page works anywhere as a single file.
import { createRoot } from 'react-dom/client';
import CipherApp from './CipherApp';
import { MARKETS } from '../../lib/cipher/markets';
import { applyResearch, buildLead, buildSignals, type Evidence, type Lead, type Research, type RunConfig, type RunEvent, type SignalKind } from '../../lib/cipher/engine';

// Hosted (claude.ai artifact) build: AI runs on the viewer's Claude via the `sample`
// capability, and CSV export goes through the `downloads` capability.
type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & { json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T> };
type ClaudeHost = { use(name: string): Promise<unknown> };
const host = (window as unknown as { claude?: ClaudeHost }).claude;
const samplePromise: Promise<SampleFn | null> = host ? host.use('sample').then(v => (v as SampleFn) || null).catch(() => null) : Promise.resolve(null);
const downloadsPromise: Promise<{ save(r: { filename: string; data: Blob | string }): Promise<unknown> } | null> = host ? host.use('downloads').then(v => (v as never) || null).catch(() => null) : Promise.resolve(null);

const blobs = new Map<string, Blob>();
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (obj: Blob | MediaSource) => { const url = createObjectURL(obj); if (obj instanceof Blob) blobs.set(url, obj); return url; };
const anchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  const blob = this.download ? blobs.get(this.href) : undefined;
  if (!blob) return anchorClick.call(this);
  const filename = this.download;
  void downloadsPromise.then(d => d?.save({ filename, data: blob })).catch(() => {});
};

const KINDS: SignalKind[] = ['hiring', 'raising', 'spending', 'news'];
const sampleError = (e: unknown) => { const code = (e as { code?: string })?.code || ''; return code === 'not_granted' || code === 'sampling_disabled' ? 401 : code === 'rate_limited' ? 429 : 502; };
const sampleCopy: Record<number, string> = { 401: 'Claude access was not allowed for this page.', 429: 'Claude is busy. Try again in a minute.', 502: 'Claude could not finish this one. Try again.' };
const safeUrl = (raw: unknown) => { try { const u = new URL(String(raw)); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; } };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function toResearch(raw: Record<string, unknown> | undefined): Research {
  const r = raw ?? {}; const sig = (r.signals ?? {}) as Record<string, Record<string, unknown>>;
  const signals: Research['signals'] = {};
  for (const kind of KINDS) {
    const item = sig[kind] ?? (kind === 'news' ? sig.momentum : undefined);
    if (!item || typeof item !== 'object') continue;
    const sources: Evidence[] = (Array.isArray(item.sources) ? item.sources : []).flatMap((x: { url?: unknown; title?: unknown }) => { const url = safeUrl(x?.url); return url ? [{ label: str(x?.title, 100) || new URL(url).hostname, url }] : []; }).slice(0, 3);
    signals[kind] = { level: Number(item.level) || 0, detail: str(item.detail, 200), sources };
  }
  const buyer = (r.buyer ?? {}) as Record<string, unknown>; const email = (r.email ?? {}) as Record<string, unknown>;
  return {
    signals,
    buyer: str(buyer.name, 80) ? { name: str(buyer.name, 80), title: str(buyer.title, 80), source: safeUrl(buyer.source) ?? undefined } : undefined,
    whyNow: str(r.why_now, 240),
    email: str(email.subject, 120) && str(email.body, 1500) ? { subject: str(email.subject, 120), body: str(email.body, 1500) } : undefined,
  };
}

// Research requests that arrive together (the page runs four at a time) share one Claude call.
type Pending = { lead: Lead; offering: string; persona: string; sender: string; resolve: (r: Response) => void };
let queue: Pending[] = []; let timer: ReturnType<typeof setTimeout> | null = null;
function enqueue(p: Pending) { queue.push(p); if (!timer) timer = setTimeout(() => void flush(), 250); }
async function flush() {
  const batch = queue.splice(0, 8); timer = queue.length ? setTimeout(() => void flush(), 250) : null;
  if (!batch.length) return;
  const sample = await samplePromise;
  if (!sample) { batch.forEach(b => b.resolve(json({ detail: 'AI research runs on Claude. Open this page in Claude and allow it to research.' }, 401))); return; }
  const { offering, persona, sender } = batch[0];
  const list = batch.map(b => `- ${b.lead.company.ticker}: ${b.lead.company.name} (${b.lead.company.domain || 'public company'}, ${b.lead.company.hq})`).join('\n');
  const prompt = `You are Cipher, a B2B sales research analyst. Today is ${new Date().toISOString().slice(0, 10)}. We sell: ${offering}. Our buyer is the ${persona}.
For each public company below, use your most recent knowledge to rate buying signals from roughly the last year:
hiring (headcount growth, especially sales and go-to-market), raising (equity or debt raises, offerings), spending (expansion, acquisitions, new products, capex), news (leadership changes, launches, results, restructuring).
Level: 0 none, 1 weak, 2 clear, 3 strong. Be factual; if unsure use a lower level. Only include source URLs for official company pages you are confident exist (careers, investor relations, newsroom); otherwise use [].
Companies:
${list}
Reply with only a JSON object keyed by ticker, each value shaped like:
{"signals":{"hiring":{"level":2,"detail":"one factual sentence","sources":[{"title":"","url":""}]},"raising":{...},"spending":{...},"news":{...}},"buyer":{"name":"current ${persona} if publicly known, else empty","title":"","source":""},"why_now":"one sentence","email":{"subject":"under 8 words","body":"under 110 words, plain text, opens with the strongest signal, asks for 15 minutes, signed ${sender}. Use {{first_name}} if the buyer name is unknown."}}`;
  try {
    const out = await sample.json<Record<string, Record<string, unknown>>>(prompt, { modelTier: 'quick' });
    for (const b of batch) {
      const raw = out?.[b.lead.company.ticker] ?? out?.[b.lead.company.ticker.toUpperCase()];
      if (!raw) { b.resolve(json({ detail: 'Claude returned no research for this account.' }, 502)); continue; }
      const lead = applyResearch(b.lead, toResearch(raw), { model: 'Claude', web: false });
      b.resolve(json({ lead, model: 'Claude', web: false, provider: 'claude' }));
    }
  } catch (e) {
    const status = sampleError(e);
    batch.forEach(b => b.resolve(json({ detail: sampleCopy[status] }, status)));
  }
}

async function ask(body: { question?: string; offering?: string; persona?: string; leads?: { ticker: string; name: string; score: number; tier: string; stage: string; why: string; signals: string[] }[] }) {
  const sample = await samplePromise;
  if (!sample) return json({ detail: 'That one needs Claude. Open this page in Claude and allow it, or ask me who to call first.' }, 401);
  const leads = (body.leads ?? []).slice(0, 40);
  const table = leads.map(l => `${l.ticker} | ${l.name} | score ${l.score} ${l.tier} | ${l.stage} | ${l.why} | ${(l.signals ?? []).join('; ')}`).join('\n');
  try {
    const { text } = await sample(`You are Cipher, the sales brain for a revenue team. Answer only from the accounts below. Be direct and specific, under 120 words, no preamble. Finish with a final line "TICKERS: X, Y" naming the accounts your answer is about (or "TICKERS: none").
We sell: ${body.offering || 'outbound for revenue teams'}. Buyer: ${body.persona || 'VP of Sales'}.
Accounts (ticker | name | score | stage | why now | signals):
${table}

Question: ${str(body.question, 500)}`, { modelTier: 'default', cache: false });
    const lines = text.trim().split('\n');
    const tag = [...lines].reverse().find(l => /^\s*TICKERS:/i.test(l)) ?? '';
    const valid = new Set(leads.map(l => l.ticker));
    const tickers = tag.replace(/^\s*TICKERS:/i, '').split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(t => valid.has(t));
    return json({ answer: lines.filter(l => l !== tag).join('\n').trim(), tickers, model: 'Claude' });
  } catch (e) { const status = sampleError(e); return json({ detail: sampleCopy[status] }, status); }
}

function json(body: unknown, status = 200) { return jsonResponse(body, status); }
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  // Always report AI as available here; a view without Claude gets a clear message on first use.
  if (url === '/api/cipher/ai') return json({ serverKey: true, provider: 'claude' });
  if (url === '/api/cipher/research') {
    const body = JSON.parse(String(init?.body || '{}')) as { lead: Lead; offering?: string; persona?: string; senderName?: string };
    return new Promise<Response>(resolve => enqueue({ lead: body.lead, offering: body.offering || 'AI-driven outbound that books qualified meetings', persona: body.persona || 'VP of Sales', sender: body.senderName || 'The Cipher team', resolve }));
  }
  if (url === '/api/cipher/ask') return ask(JSON.parse(String(init?.body || '{}')));
  if (url === '/api/cipher/dispatch') return json({ ok: false, detail: 'Add your sending webhook in the full Cipher app.' }, 400);
  if (url === '/api/cipher/run') {
    const cfg = JSON.parse(String(init?.body || '{}')) as Partial<RunConfig> & { tickers?: string[] };
    const market = MARKETS.find(m => m.id === cfg.marketId) ?? MARKETS[0];
    const known = new Map(MARKETS.flatMap(m => m.companies).map(c => [c.ticker, c]));
    const custom = (cfg.tickers ?? []).map(t => known.get(t)).filter(Boolean) as typeof market.companies;
    const companies = custom.length ? custom : market.companies;
    const run: RunConfig = { marketId: market.id, offering: cfg.offering || 'AI-driven outbound that books qualified meetings', persona: cfg.persona || 'VP of Sales', senderName: cfg.senderName || '' };
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (e: RunEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'));
        const at = () => new Date().toISOString();
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
        let hot = 0, warm = 0, signals = 0;
        emit({ type: 'step', at: at(), text: `Territory: ${custom.length ? 'your list' : market.label}, ${companies.length} public companies` });
        emit({ type: 'step', at: at(), text: `Buyer: ${run.persona}. Offer: ${run.offering}` });
        for (const company of companies) {
          emit({ type: 'step', at: at(), ticker: company.ticker, text: `Scanning ${company.name}: filings and hiring snapshot` });
          await wait(160);
          const sigs = buildSignals(company, {}); const lead = buildLead(company, sigs, run);
          signals += sigs.length; if (lead.tier === 'Hot') hot++; else if (lead.tier === 'Warm') warm++;
          emit({ type: 'step', at: at(), ticker: company.ticker, tone: lead.tier === 'Hot' ? 'good' : 'info', text: `${company.name}: ${sigs.length} signals, score ${lead.score} (${lead.tier}), demo estimates` });
          emit({ type: 'step', at: at(), ticker: company.ticker, text: `Drafted the first email to the ${run.persona} and a 4-touch sequence` });
          emit({ type: 'lead', at: at(), lead });
        }
        emit({ type: 'step', at: at(), tone: 'good', text: `Ranked ${companies.length} accounts: ${hot} hot, ${warm} warm` });
        emit({ type: 'done', at: at(), summary: { scanned: companies.length, hot, warm, signals, liveSources: 0 } });
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
  }
  return realFetch(input, init);
};

createRoot(document.getElementById('cipher-root')!).render(<CipherApp />);
