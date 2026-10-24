import { NextRequest, NextResponse } from 'next/server';
import { cookieOptions, signPayload } from '../../../../../lib/auth-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  const apiToken = process.env.GROKBOT_BACKEND_API_TOKEN || process.env.BACKEND_API_TOKEN || '';
  if (!backend || apiToken.length < 32 || !token) return NextResponse.redirect(new URL('/login?error=magic-link', request.url));
  try {
    const backendUrl = new URL('/api/auth/email/verify', backend); backendUrl.searchParams.set('token', token);
    const response = await fetch(backendUrl, { headers: { Authorization: `Bearer ${apiToken}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return NextResponse.redirect(new URL('/login?error=magic-link', request.url));
    const account = await response.json() as { id?: string; email?: string; display_name?: string };
    if (!account.id || !account.email) return NextResponse.redirect(new URL('/login?error=magic-link', request.url));
    const result = NextResponse.redirect(new URL('/', process.env.GROKBOT_PUBLIC_URL || request.url));
    result.cookies.set('grokbot_session', signPayload({ sub: account.id, email: account.email, name: account.display_name, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }), cookieOptions(60 * 60 * 24 * 7));
    return result;
  } catch { return NextResponse.redirect(new URL('/login?error=magic-link', request.url)); }
}
