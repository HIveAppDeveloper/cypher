import { MARKETS, type Company } from '../../../../lib/cipher/markets';
import { buildLead, buildSignals, isGtmRole, type Evidence, type RawSignals, type RunConfig, type RunEvent } from '../../../../lib/cipher/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEC_UA = process.env.CIPHER_SEC_USER_AGENT || 'Cypher Territory Pulse support@cipher.app';
let tickerMap: Promise<Map<string, number>> | null = null;

async function fetchJson(url: string, ms = 4500, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(ms), cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function secTickers() {
  tickerMap ??= fetchJson('https://www.sec.gov/files/company_tickers.json', 6000, { 'User-Agent': SEC_UA })
    .then((data: Record<string, { cik_str: number; ticker: string }>) => new Map(Object.values(data).map(row => [row.ticker.toUpperCase(), row.cik_str])))
    .catch(error => { tickerMap = null; throw error; });
  return tickerMap;
}

async function liveFilings(ticker: string): Promise<RawSignals['filings']> {
  const cik = (await secTickers()).get(ticker.toUpperCase());
  if (!cik) throw new Error('No CIK');
  const padded = String(cik).padStart(10, '0');
  const data = await fetchJson(`https://data.sec.gov/submissions/CIK${padded}.json`, 4500, { 'User-Agent': SEC_UA });
  const r = data.filings.recent as { form: string[]; filingDate: string[]; accessionNumber: string[]; primaryDocument: string[] };
  const now = Date.now(), day = 86_400_000;
  const out = { recent90: 0, raising: [] as Evidence[], material: [] as Evidence[], spend: [] as Evidence[] };
  for (let i = 0; i < Math.min(r.form.length, 120); i++) {
    const age = (now - Date.parse(r.filingDate[i])) / day;
    if (age > 180) break;
    const form = r.form[i];
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`;
    const ev = { label: `${form} filed ${r.filingDate[i]}`, url, date: r.filingDate[i] };
    if (age <= 90) out.recent90++;
    if (/^(S-1|S-3|424B\d|F-1|F-3)/.test(form)) out.raising.push(ev);
    else if (form === '8-K' && age <= 90) out.material.push(ev);
    else if (/^(10-Q|10-K|20-F)/.test(form)) out.spend.push(ev);
  }
  return out;
}

async function liveJobs(board: string): Promise<RawSignals['jobs']> {
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`);
  const jobs = (data.jobs || []) as { title: string; absolute_url: string; updated_at?: string }[];
  const gtm = jobs.filter(job => isGtmRole(job.title));
  return { total: jobs.length, gtm: gtm.length, samples: (gtm.length ? gtm : jobs).slice(0, 4).map(job => ({ label: job.title, url: job.absolute_url, date: job.updated_at?.slice(0, 10) })) };
}

function customCompany(ticker: string): Company {
  return { name: ticker, ticker, domain: '', hq: 'Public company', snapshot: { openRoles: 0, gtmRoles: 0, raisedRecently: false, filings90d: 0, capexTrend: 'flat' } };
}

export async function POST(req: Request) {
  const cfg = await req.json().catch(() => ({})) as Partial<RunConfig>;
  const market = MARKETS.find(m => m.id === cfg.marketId) ?? MARKETS[0];
  const custom = (Array.isArray(cfg.tickers) ? cfg.tickers : []).filter((t): t is string => typeof t === 'string').map(t => t.trim().toUpperCase()).filter(t => /^[A-Z.]{1,6}$/.test(t)).slice(0, 20);
  const known = new Map(MARKETS.flatMap(m => m.companies).map(co => [co.ticker, co]));
  const companies = custom.length ? custom.map(t => known.get(t) ?? customCompany(t)) : market.companies.slice(0, 20);
  const text = (v: unknown, fallback: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim() : fallback).slice(0, max);
  const run: RunConfig = { marketId: market.id, offering: text(cfg.offering, 'AI-driven outbound that books qualified meetings', 200), persona: text(cfg.persona, 'VP of Sales', 60), senderName: text(cfg.senderName, '', 60) };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event: RunEvent) => { if (!open) return; try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch { open = false; } };
      const at = () => new Date().toISOString();
      let signals = 0, hot = 0, warm = 0, liveSources = 0;
      emit({ type: 'step', at: at(), text: `Territory: ${custom.length ? 'your list' : market.label}, ${companies.length} public companies` });
      emit({ type: 'step', at: at(), text: `Buyer: ${run.persona}. Offer: ${run.offering}` });
      const work = companies.map(async (company, index) => {
        await new Promise(r => setTimeout(r, index * 140));
        try {
          emit({ type: 'step', at: at(), ticker: company.ticker, text: `Scanning ${company.name}: SEC EDGAR filings${company.greenhouse ? ' and its public job board' : ''}` });
          const [filings, jobs] = await Promise.allSettled([liveFilings(company.ticker), company.greenhouse ? liveJobs(company.greenhouse) : Promise.reject(new Error('no board'))]);
          const raw: RawSignals = { filings: filings.status === 'fulfilled' ? filings.value : undefined, jobs: jobs.status === 'fulfilled' ? jobs.value : undefined };
          liveSources += Number(Boolean(raw.filings)) + Number(Boolean(raw.jobs));
          const sigs = buildSignals(company, raw);
          const lead = buildLead(company, sigs, run);
          signals += sigs.length; if (lead.tier === 'Hot') hot++; else if (lead.tier === 'Warm') warm++;
          const live = [raw.filings && 'EDGAR', raw.jobs && 'jobs'].filter(Boolean).join(' + ');
          emit({ type: 'step', at: at(), ticker: company.ticker, tone: lead.tier === 'Hot' ? 'good' : live ? 'info' : 'warn', text: `${company.name}: ${sigs.length} signals, score ${lead.score} (${lead.tier}), ${live ? `live ${live}` : 'demo estimates (live sources unreachable)'}` });
          emit({ type: 'step', at: at(), ticker: company.ticker, text: `Drafted the first email to the ${run.persona} and a 4-touch sequence` });
          emit({ type: 'lead', at: at(), lead });
        } catch {
          emit({ type: 'step', at: at(), ticker: company.ticker, tone: 'warn', text: `${company.name}: skipped, the data for this account could not be read` });
        }
      });
      await Promise.all(work);
      emit({ type: 'step', at: at(), tone: 'good', text: `Ranked ${companies.length} accounts: ${hot} hot, ${warm} warm, ${liveSources} live data pulls` });
      emit({ type: 'done', at: at(), summary: { scanned: companies.length, hot, warm, signals, liveSources } });
      if (open) { open = false; controller.close(); }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
