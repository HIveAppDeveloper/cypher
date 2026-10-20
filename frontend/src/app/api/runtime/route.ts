import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export async function GET() {
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ connected: false, state: 'unconfigured' }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const response = await fetch(new URL('/health', backend), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return NextResponse.json({ connected: response.ok, state: response.ok ? 'connected' : 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ connected: false, state: 'unavailable' }, { headers: { 'Cache-Control': 'no-store' } }); }
}
