import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ connected: false, state: 'unconfigured' }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const response = await fetch(new URL('/api/runtime', backend), { headers: { Authorization: 'Bearer ' + (process.env.GROKBOT_BACKEND_API_TOKEN || '') }, cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const detail = response.ok ? await response.json() : {};
    return NextResponse.json({ ...detail, connected: response.ok, state: response.ok ? 'connected' : 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ connected: false, state: 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } }); }
}
