import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookieHeader } from '../../../lib/auth-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const session = getSessionFromCookieHeader(request.headers.get('cookie'));
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session) return NextResponse.json({ detail: 'Sign in to continue.' }, { status: 401 });
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ connected: false, state: 'unconfigured' }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + (process.env.GROKBOT_BACKEND_API_TOKEN || '') };
    if (session) headers['x-grokbot-user-id'] = session.sub;
    const response = await fetch(new URL('/api/runtime', backend), { headers, cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const detail = await response.json().catch(()=>({}));
    return NextResponse.json({ ...detail, connected: response.ok, state: response.ok ? 'connected' : 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ connected: false, state: 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } }); }
}
