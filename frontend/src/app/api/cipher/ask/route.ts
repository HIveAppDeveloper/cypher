import { AiError, chat, pickModels, resolveKey } from '../../../../lib/cipher/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Brief = { ticker: string; name: string; score: number; tier: string; stage: string; why: string; signals: string[] };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// "Ask the brain": answers questions about the current territory using only the accounts sent.
export async function POST(req: Request) {
  const key = resolveKey(req);
  if (!key) return Response.json({ detail: 'Add an OpenRouter key in Setup, or set OPENROUTER_API_KEY on the server.' }, { status: 401 });
  const body = await req.json().catch(() => null) as { question?: string; offering?: string; persona?: string; leads?: Brief[] } | null;
  const question = str(body?.question, 500);
  const leads = (Array.isArray(body?.leads) ? body!.leads : []).slice(0, 40).map(l => ({
    ticker: str(l.ticker, 8), name: str(l.name, 80), score: Number(l.score) || 0, tier: str(l.tier, 8), stage: str(l.stage, 16), why: str(l.why, 240),
    signals: (Array.isArray(l.signals) ? l.signals : []).slice(0, 4).map(s => str(s, 220)),
  })).filter(l => l.ticker);
  if (!question || !leads.length) return Response.json({ detail: 'Run Outbound first, then ask a question about the accounts.' }, { status: 400 });

  const table = leads.map(l => `${l.ticker} | ${l.name} | score ${l.score} ${l.tier} | ${l.stage} | ${l.why} | ${l.signals.join('; ')}`).join('\n');
  try {
    const { brain } = await pickModels(key);
    const out = await chat(key, {
      model: brain, maxTokens: 600, timeoutMs: 45_000,
      messages: [
        { role: 'system', content: 'You are Cipher, the sales brain for a revenue team. Answer only from the accounts provided. Be direct and specific, under 120 words, no preamble. Finish with a final line "TICKERS: X, Y" naming the accounts your answer is about (or "TICKERS: none").' },
        { role: 'user', content: `We sell: ${str(body?.offering, 200) || 'outbound for revenue teams'}. Buyer: ${str(body?.persona, 60) || 'VP of Sales'}.\nAccounts (ticker | name | score | stage | why now | signals):\n${table}\n\nQuestion: ${question}` },
      ],
    });
    const lines = out.text.trim().split('\n');
    const tagLine = lines.findLast(line => /^\s*TICKERS:/i.test(line)) ?? '';
    const valid = new Set(leads.map(l => l.ticker));
    const tickers = tagLine.replace(/^\s*TICKERS:/i, '').split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(t => valid.has(t));
    const answer = lines.filter(line => line !== tagLine).join('\n').trim();
    return Response.json({ answer, tickers, model: out.model });
  } catch (error) {
    const status = error instanceof AiError ? error.status : 502;
    return Response.json({ detail: error instanceof AiError ? error.message : 'The brain could not answer. Try again.' }, { status: status === 401 || status === 402 || status === 429 ? status : 502 });
  }
}
