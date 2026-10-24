import { NextRequest, NextResponse } from 'next/server';
import { cookieOptions, signPayload } from '../../../../../lib/auth-server';
import { safeInternalReturnTo } from '../../../../../lib/canonical-app';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const returnTo = safeInternalReturnTo(request.nextUrl.searchParams.get('return_to')) || '/';
  const loginWithError = () => {
    const destination = new URL('/login', process.env.GROKBOT_PUBLIC_URL || request.nextUrl.origin);
    destination.searchParams.set('error', 'magic-link');
    const savedReturnTo = safeInternalReturnTo(request.nextUrl.searchParams.get('return_to'));
    if (savedReturnTo) destination.searchParams.set('returnTo', savedReturnTo);
    return NextResponse.redirect(destination);
  };
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  const apiToken = process.env.GROKBOT_BACKEND_API_TOKEN || process.env.BACKEND_API_TOKEN || '';
  if (!backend || apiToken.length < 32 || !token) return loginWithError();
  try {
    const backendUrl = new URL('/api/auth/email/verify', backend); backendUrl.searchParams.set('token', token);
    const response = await fetch(backendUrl, { headers: { Authorization: `Bearer ${apiToken}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return loginWithError();
    const account = await response.json() as { id?: string; email?: string; display_name?: string };
    if (!account.id || !account.email) return loginWithError();
    const result = NextResponse.redirect(new URL(returnTo, process.env.GROKBOT_PUBLIC_URL || request.nextUrl.origin));
    result.cookies.set('grokbot_session', signPayload({ sub: account.id, email: account.email, name: account.display_name, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }), cookieOptions(60 * 60 * 24 * 7));
    return result;
  } catch { return loginWithError(); }
}
