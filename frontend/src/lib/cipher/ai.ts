import type { Evidence } from './engine';

// Server-side OpenRouter client for Cipher. The key comes from the caller's
// x-openrouter-key header (set in Setup, kept in that browser) or OPENROUTER_API_KEY.
const OPENROUTER = 'https://openrouter.ai/api/v1';
const FALLBACK = { research: 'anthropic/claude-sonnet-4.5', brain: 'anthropic/claude-opus-4.1' };
let catalog: { at: number; ids: string[] } | null = null;

export class AiError extends Error { constructor(public status: number, message: string) { super(message); } }

export function resolveKey(req: Request): string | null {
  const fromHeader = req.headers.get('x-openrouter-key')?.trim();
  if (fromHeader && /^[\w-]{20,200}$/.test(fromHeader)) return fromHeader;
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

async function modelIds(key: string): Promise<string[]> {
  if (catalog && Date.now() - catalog.at < 30 * 60_000) return catalog.ids;
  const res = await fetch(`${OPENROUTER}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
  if (!res.ok) throw new AiError(res.status, 'Model list unavailable');
  const data = await res.json() as { data?: { id: string }[] };
  catalog = { at: Date.now(), ids: (data.data ?? []).map(m => m.id) };
  return catalog.ids;
}

const version = (id: string) => Number((id.match(/\d+(?:\.\d+)?/) ?? ['0'])[0]);
function newest(ids: string[], family: 'sonnet' | 'opus') {
  return ids
    .filter(id => id.startsWith('anthropic/claude') && id.includes(family) && !id.includes(':'))
    .sort((a, b) => version(b) - version(a) || a.length - b.length)[0];
}

export async function pickModels(key: string) {
  const ids = await modelIds(key).catch(() => [] as string[]);
  const research = process.env.CIPHER_RESEARCH_MODEL || newest(ids, 'sonnet') || FALLBACK.research;
  const brain = process.env.CIPHER_BRAIN_MODEL || newest(ids, 'opus') || newest(ids, 'sonnet') || FALLBACK.brain;
  return { research, brain };
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };
export async function chat(key: string, opts: { model: string; messages: Message[]; web?: boolean; maxTokens?: number; timeoutMs?: number }) {
  const res = await fetch(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.GROKBOT_PUBLIC_URL || 'https://open-grokbot-hiveapp.vercel.app', 'X-Title': 'Cipher' },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, max_tokens: opts.maxTokens ?? 1200, temperature: .2, ...(opts.web ? { plugins: [{ id: 'web', max_results: 6 }] } : {}) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 50_000), cache: 'no-store',
  });
  const data = await res.json().catch(() => ({})) as {
    error?: { message?: string };
    model?: string;
    choices?: { message?: { content?: string | { type: string; text?: string }[]; annotations?: { type: string; url_citation?: { url: string; title?: string } }[] } }[];
  };
  if (!res.ok || data.error) throw new AiError(res.status >= 400 ? res.status : 502, friendly(res.status, data.error?.message));
  const message = data.choices?.[0]?.message;
  const content = message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
  const citations: Evidence[] = (message?.annotations ?? [])
    .filter(a => a.type === 'url_citation' && a.url_citation && safeUrl(a.url_citation.url))
    .map(a => ({ label: a.url_citation!.title || new URL(a.url_citation!.url).hostname, url: a.url_citation!.url }));
  return { text, citations, model: data.model || opts.model };
}

function friendly(status: number, detail?: string) {
  if (status === 401) return 'OpenRouter rejected the API key. Check it in Setup.';
  if (status === 402) return 'The OpenRouter account is out of credits.';
  if (status === 429) return 'OpenRouter is rate limiting this key. Try again in a minute.';
  return detail ? `OpenRouter: ${detail}`.slice(0, 200) : `OpenRouter answered ${status}.`;
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
