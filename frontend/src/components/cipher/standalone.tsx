// Standalone entry for the shareable Cipher demo: runs the territory scan in the browser
// from built-in data (no server), so the page works anywhere as a single file.
import { createRoot } from 'react-dom/client';
import CipherApp from './CipherApp';
import { MARKETS } from '../../lib/cipher/markets';
import { buildLead, buildSignals, type RunConfig, type RunEvent } from '../../lib/cipher/engine';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (url === '/api/cipher/ai') return json({ serverKey: false, standalone: true });
  if (url === '/api/cipher/research' || url === '/api/cipher/ask') return json({ detail: 'AI research runs in the hosted Cipher app with an OpenRouter key. This shared demo uses built-in data.' }, 503);
  if (url === '/api/cipher/dispatch') return json({ ok: false, detail: 'Sending runs in the hosted Cipher app.' }, 503);
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
