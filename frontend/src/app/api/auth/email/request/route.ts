import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  const token = process.env.GROKBOT_BACKEND_API_TOKEN || process.env.BACKEND_API_TOKEN || '';
  if (!backend || token.length < 32) return NextResponse.json({ detail: 'Email sign-in is not configured yet.' }, { status: 503 });
  let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ detail: 'Enter your email address.' }, { status: 422 }); }
  try {
    const response = await fetch(new URL('/api/auth/email/request', backend), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({ detail: 'Could not request a sign-in link.' }));
    return NextResponse.json(payload, { status: response.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ detail: 'The sign-in service is starting or unavailable. Try again shortly.' }, { status: 503 }); }
}
