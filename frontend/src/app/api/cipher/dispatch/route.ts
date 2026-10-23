export const dynamic = 'force-dynamic';

// Relays launched sequences to the user's own sending tool (Zapier, Make, Clay, a Base44 function),
// so browser CORS rules on the webhook host cannot drop the delivery.
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

function allowed(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (PRIVATE_HOST.test(url.hostname) || IP_LITERAL.test(url.hostname) || !url.hostname.includes('.')) return null;
    return url;
  } catch { return null; }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { webhook?: string; payload?: unknown } | null;
  const url = body?.webhook ? allowed(body.webhook) : null;
  if (!url) return Response.json({ ok: false, detail: 'Use a public https:// webhook address.' }, { status: 400 });
  const payload = JSON.stringify(body?.payload ?? {});
  if (payload.length > 400_000) return Response.json({ ok: false, detail: 'Too many leads in one send.' }, { status: 413 });
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Cipher/1.0' }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return Response.json({ ok: res.ok, status: res.status, detail: res.ok ? 'Delivered' : `Your sending tool answered ${res.status}.` }, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ ok: false, detail: 'Your sending tool could not be reached.' }, { status: 502 });
  }
}
