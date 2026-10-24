import type { Evidence } from './engine';

// Server-side model access for Cypher.
// Order: an OpenRouter key typed into Setup (x-openrouter-key) → the deployment's OmniRoute
// gateway (OMNIROUTE_URL + OMNIROUTE_API_KEY, the same one GrokBot uses) → OPENROUTER_API_KEY.
const OPENROUTER = 'https://openrouter.ai/api/v1';
const OPENROUTER_FALLBACK = { research: 'anthropic/claude-sonnet-4.5', brain: 'anthropic/claude-opus-4.1' };
// OmniRoute routes configured for GrokBot (backend/app/services/model_profiles.py), best first.
const OMNIROUTE_MODELS = {
  research: ['cx/gpt-6.1-sol', 'ddgw/claude-haiku-4-5', 'ds-web/deepseek-v4-flash', 'ddgw/gpt-5.4-mini'],
  brain: ['cx/gpt-6-astra', 'cx/gpt-6.1-sol', 'ddgw/claude-haiku-4-5', 'ds-web/deepseek-v4-flash'],
};
let catalog: { at: number; ids: string[] } | null = null;

export class AiError extends Error { constructor(public status: number, message: string) { super(message); } }
export type Provider = { kind: 'omniroute' | 'openrouter'; base: string; headers: Record<string, string> };

function omniroute(): Provider | null {
  const raw = process.env.OMNIROUTE_URL?.trim(), key = process.env.OMNIROUTE_API_KEY?.trim();
  if (!raw || !key) return null;
  try {
    const url = new URL(raw.replace(/\/+$/, ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || !['', '/', '/v1'].includes(url.pathname)) return null;
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (process.env.OMNIROUTE_PROTECTION_BYPASS) headers['x-vercel-protection-bypass'] = process.env.OMNIROUTE_PROTECTION_BYPASS;
    return { kind: 'omniroute', base: `${url.origin}/v1`, headers };
  } catch { return null; }
}
const openrouter = (key: string): Provider => ({ kind: 'openrouter', base: OPENROUTER, headers: { Authorization: `Bearer ${key}`, 'HTTP-Referer': process.env.GROKBOT_PUBLIC_URL || 'https://cypher-agent.vercel.app', 'X-Title': 'Cypher' } });

export function serverProvider(): Provider['kind'] | null {
  return omniroute() ? 'omniroute' : process.env.OPENROUTER_API_KEY?.trim() ? 'openrouter' : null;
}

export function resolveProvider(req: Request): Provider | null {
  const fromHeader = req.headers.get('x-openrouter-key')?.trim();
  if (fromHeader && /^[\w-]{20,200}$/.test(fromHeader)) return openrouter(fromHeader);
  const omni = omniroute(); if (omni) return omni;
  const env = process.env.OPENROUTER_API_KEY?.trim();
  return env ? openrouter(env) : null;
}

async function modelIds(p: Provider): Promise<string[]> {
  if (catalog && Date.now() - catalog.at < 30 * 60_000) return catalog.ids;
  const res = await fetch(`${p.base}/models`, { headers: p.headers, signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new AiError(res.status, 'Model list unavailable');
  const data = await res.json() as { data?: { id: string }[] };
  catalog = { at: Date.now(), ids: (data.data ?? []).map(m => m.id) };
  return catalog.ids;
}
const version = (id: string) => Number((id.match(/\d+(?:\.\d+)?/) ?? ['0'])[0]);
const newest = (ids: string[], family: 'sonnet' | 'opus') => ids.filter(id => id.startsWith('anthropic/claude') && id.includes(family) && !id.includes(':')).sort((a, b) => version(b) - version(a) || a.length - b.length)[0];

export async function pickModels(p: Provider): Promise<{ research: string[]; brain: string[] }> {
  const pin = (env: string | undefined, list: string[]) => (env ? [env, ...list.filter(m => m !== env)] : list);
  if (p.kind === 'omniroute') return { research: pin(process.env.CIPHER_RESEARCH_MODEL, OMNIROUTE_MODELS.research), brain: pin(process.env.CIPHER_BRAIN_MODEL, OMNIROUTE_MODELS.brain) };
  const ids = await modelIds(p).catch(() => [] as string[]);
  const research = process.env.CIPHER_RESEARCH_MODEL || newest(ids, 'sonnet') || OPENROUTER_FALLBACK.research;
  const brain = process.env.CIPHER_BRAIN_MODEL || newest(ids, 'opus') || newest(ids, 'sonnet') || OPENROUTER_FALLBACK.brain;
  return { research: [research], brain: [brain, research].filter((m, i, a) => a.indexOf(m) === i) };
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
async function once(p: Provider, model: string, opts: { messages: Message[]; web: boolean; maxTokens: number; timeoutMs: number }) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST', redirect: 'manual',
    headers: { ...p.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: opts.messages, max_tokens: opts.maxTokens, temperature: .2, ...(opts.web ? { plugins: [{ id: 'web', max_results: 6 }] } : {}) }),
    signal: AbortSignal.timeout(opts.timeoutMs), cache: 'no-store',
  });
  const data = await res.json().catch(() => ({})) as {
    error?: { message?: string } | string; model?: string;
    choices?: { message?: { content?: string | { type: string; text?: string }[]; annotations?: { type: string; url_citation?: { url: string; title?: string } }[] } }[];
  };
  if (!res.ok || data.error) throw new AiError(res.status >= 400 ? res.status : 502, friendly(p, res.status, typeof data.error === 'string' ? data.error : data.error?.message));
  const message = data.choices?.[0]?.message; const content = message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
  if (!text.trim()) throw new AiError(502, 'The model returned an empty answer.');
  const citations: Evidence[] = (message?.annotations ?? [])
    .filter(a => a.type === 'url_citation' && a.url_citation && safeUrl(a.url_citation.url))
    .map(a => ({ label: a.url_citation!.title || new URL(a.url_citation!.url).hostname, url: a.url_citation!.url }));
  return { text, citations, model: data.model || model };
}

// Tries each model in order; stops early on key or credit problems, which no other model fixes.
export async function chat(p: Provider, opts: { models: string[]; messages: Message[]; web?: boolean; maxTokens?: number; timeoutMs?: number }) {
  let last: unknown = null;
  for (const model of opts.models) {
    const base = { messages: opts.messages, maxTokens: opts.maxTokens ?? 1200, timeoutMs: opts.timeoutMs ?? 45_000 };
    try {
      if (p.kind === 'openrouter' && opts.web) {
        try { return { ...(await once(p, model, { ...base, web: true })), web: true }; }
        catch (error) { if (!(error instanceof AiError) || ![400, 404, 422].includes(error.status)) throw error; }
      }
      return { ...(await once(p, model, { ...base, web: false })), web: false };
    } catch (error) {
      last = error;
      if (error instanceof AiError && (error.status === 401 || error.status === 402)) throw error;
    }
  }
  if (last instanceof AiError) throw last;
  throw new AiError(502, last instanceof Error && last.name === 'TimeoutError' ? 'The model took too long to answer.' : 'No model answered. Try again.');
}

function friendly(p: Provider, status: number, detail?: string) {
  const name = p.kind === 'omniroute' ? 'OmniRoute' : 'OpenRouter';
  if (status === 401) return `${name} rejected the API key.`;
  if (status === 402) return `The ${name} account is out of credits.`;
  if (status === 429) return `${name} is rate limiting. Try again in a minute.`;
  return p.kind === 'openrouter' && detail ? `OpenRouter: ${detail}`.slice(0, 200) : `${name} answered ${status}.`;
}

export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
}

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiError(502, 'The model did not return structured research.');
  return JSON.parse(cleaned.slice(start, end + 1));
}
