import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;
const BACKEND_HEALTH_TIMEOUT_MS = 8_000;

// Public readiness probe. Never return internal addresses, tokens, or upstream errors.
export async function GET() {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ service: 'cypher', status: 'unconfigured' }, { status: 503, headers });
  try {
    const response = await fetch(new URL('/health', backend), {
      cache: 'no-store', signal: AbortSignal.timeout(BACKEND_HEALTH_TIMEOUT_MS),
    });
    return NextResponse.json({ service: 'cypher', status: response.ok ? 'ok' : 'unavailable' }, { status: response.ok ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ service: 'cypher', status: 'unavailable' }, { status: 503, headers });
  }
}
