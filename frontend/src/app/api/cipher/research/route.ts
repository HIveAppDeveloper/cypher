import { AiError, chat, extractJson, pickModels, resolveProvider, safeUrl } from '../../../../lib/cipher/ai';
import { applyResearch, type Evidence, type Lead, type Research, type SignalKind } from '../../../../lib/cipher/engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KINDS: SignalKind[] = ['hiring', 'raising', 'spending', 'news'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function sources(v: unknown): Evidence[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap(item => {
    const url = safeUrl(typeof item === 'string' ? item : (item as { url?: unknown })?.url);
    if (!url) return [];
    const label = str((item as { title?: unknown })?.title, 120) || new URL(url).hostname;
    return [{ label, url }];
  }).slice(0, 4);
}

function toResearch(raw: unknown, citations: Evidence[]): Research {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sig = (r.signals ?? {}) as Record<string, unknown>;
  const signals: Research['signals'] = {};
  for (const kind of KINDS) {
    const item = (sig[kind] ?? sig[kind === 'news' ? 'momentum' : kind]) as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') continue;
    signals[kind] = { level: Number(item.level) || 0, detail: str(item.detail, 200), sources: sources(item.sources) };
  }
  const buyer = (r.buyer ?? {}) as Record<string, unknown>;
  const email = (r.email ?? {}) as Record<string, unknown>;
  return {
    signals,
    buyer: str(buyer.name, 80) ? { name: str(buyer.name, 80), title: str(buyer.title, 80), source: safeUrl(buyer.source) ?? undefined } : undefined,
    whyNow: str(r.why_now ?? r.whyNow, 240),
    email: str(email.subject, 120) && str(email.body, 1500) ? { subject: str(email.subject, 120), body: str(email.body, 1500) } : undefined,
    citations,
  };
}

export async function POST(req: Request) {
  const provider = resolveProvider(req);
  if (!provider) return Response.json({ detail: 'No model gateway is configured. Set OMNIROUTE_URL and OMNIROUTE_API_KEY (or OPENROUTER_API_KEY) on the server, or add an OpenRouter key in Setup.' }, { status: 401 });
  const body = await req.json().catch(() => null) as { lead?: Lead; offering?: string; persona?: string; senderName?: string } | null;
  const lead = body?.lead;
  if (!lead?.company || typeof lead.company.name !== 'string' || typeof lead.company.ticker !== 'string' || !Array.isArray(lead.signals)) return Response.json({ detail: 'Send a lead from a Cypher run.' }, { status: 400 });
  const offering = str(body?.offering, 200) || 'AI-driven outbound that books qualified meetings';
  const persona = str(body?.persona, 60) || lead.buyer?.persona || 'VP of Sales';
  const sender = str(body?.senderName, 60) || 'The Cypher team';
  const known = lead.signals.filter(s => s.source === 'live').map(s => `- ${s.kind}: ${s.headline}`).join('\n') || '- none verified yet';
  const today = new Date().toISOString().slice(0, 10);

  const messages = [
    { role: 'system' as const, content: 'You are Cypher, a B2B sales research analyst. Use web search results when available, otherwise your most recent knowledge of the company. Report only facts you can attribute; if you are unsure, give a lower level. Respond with a single JSON object and nothing else.' },
    { role: 'user' as const, content: `Today is ${today}. Research ${str(lead.company.name, 80)} (ticker ${str(lead.company.ticker, 8)}${lead.company.domain ? `, ${str(lead.company.domain, 80)}` : ''}, ${str(lead.company.hq, 60)}).
We sell: ${offering}. Our buyer is the ${persona}.
Verified data we already have:
${known}

Find buying signals from roughly the last six months:
- hiring: headcount growth, especially sales, revenue and go-to-market roles
- raising: equity or debt raises, offerings, credit facilities
- spending: expansion, capex, acquisitions, new products, new markets
- news: momentum such as leadership changes, launches, strong or weak results, restructuring

Return JSON exactly in this shape:
{"signals":{"hiring":{"level":0-3,"detail":"one factual sentence with numbers and dates","sources":[{"title":"","url":""}]},"raising":{...},"spending":{...},"news":{...}},
"buyer":{"name":"current ${persona} or closest public go-to-market leader, empty if unknown","title":"","source":"url"},
"why_now":"one sentence on why to reach out this month",
"email":{"subject":"under 8 words","body":"under 110 words, plain text, opens with the strongest signal, one clear ask for 15 minutes, signed ${sender}. Use {{first_name}} if the buyer name is unknown."}}
Level: 0 none, 1 weak, 2 clear, 3 strong.` },
  ];

  try {
    const models = await pickModels(provider);
    const out = await chat(provider, { models: models.research, messages, web: true, maxTokens: 1400, timeoutMs: 40_000 });
    const research = toResearch(extractJson(out.text), out.citations);
    const updated = applyResearch(lead, research, { model: out.model, web: out.web });
    return Response.json({ lead: updated, model: out.model, web: out.web, provider: provider.kind });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 502;
    const detail = error instanceof AiError ? error.message : error instanceof SyntaxError ? 'The model returned research Cypher could not read.' : 'Research failed. Try again.';
    return Response.json({ detail }, { status: status === 401 || status === 402 || status === 429 ? status : 502 });
  }
}
