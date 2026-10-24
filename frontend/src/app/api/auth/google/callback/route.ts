import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cookieOptions, signPayload, getSessionFromCookieHeader } from '../../../../../lib/auth-server';

export const dynamic = 'force-dynamic';
export const maxDuration=120;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
export async function POST(request: NextRequest) {
  const origin = process.env.GROKBOT_PUBLIC_URL || request.nextUrl.origin;
  const failure = (error: string) => NextResponse.redirect(new URL('/login?error=' + error, origin), 303);
  let form: FormData;
  try { form = await request.formData(); } catch { return failure('google'); }
  const cookie = request.cookies.get('g_csrf_token')?.value || '';
  const body = form.get('g_csrf_token');
  if (typeof body !== 'string' || !cookie || Buffer.byteLength(cookie) !== Buffer.byteLength(body) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(body))) return failure('google-csrf');
  const credential = form.get('credential');
  if (typeof credential !== 'string' || credential.length > 12000) return failure('google');
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  const apiToken = process.env.GROKBOT_BACKEND_API_TOKEN || process.env.BACKEND_API_TOKEN;
  if (!backend || !apiToken) return failure('unavailable');
  try {
    const response = await fetch(new URL('/api/auth/google/verify', backend), {
      method: 'POST', headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }), cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return failure(response.status === 409 ? 'email-required' : 'google');
    const account = await response.json() as { id?: string; email?: string; display_name?: string };
    if (!account.id || !account.email) return failure('google');
    const result = NextResponse.redirect(new URL('/connect/google?welcome=1', origin), 303);
    result.cookies.set('grokbot_session', signPayload({ sub: account.id, email: account.email, name: account.display_name, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }), cookieOptions(SESSION_SECONDS));
    result.cookies.delete('g_csrf_token');
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  } catch { return failure('unavailable'); }
}

export async function GET(request:NextRequest){
 const state=request.nextUrl.searchParams.get('state')||'';
 const flow=state.split('.')[0];const valid=/^[0-9a-f-]{36}$/.test(flow);
 const binding=valid?request.cookies.get('cypher-google-'+flow)?.value:undefined;
 const session=getSessionFromCookieHeader(request.headers.get('cookie'));
 const backend=process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL;
 let status='failed';
 if(binding&&session&&backend)try{
  const response=await fetch(new URL('/api/google/callback',backend),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN||''}`,'x-grokbot-user-id':session.sub},body:JSON.stringify({state,binding,code:request.nextUrl.searchParams.get('code')||'',denied:request.nextUrl.searchParams.has('error')}),cache:'no-store',signal:AbortSignal.timeout(100000)});
  const data=await response.json();if(response.ok&&['connected','cancelled'].includes(data.status))status=data.status;
 }catch{}
 const result=NextResponse.redirect(new URL('/connect/google?result='+status,request.nextUrl.origin),303);
 result.headers.set('Cache-Control','private, no-store');result.headers.set('Referrer-Policy','no-referrer');
 if(valid)result.cookies.set('cypher-google-'+flow,'',{...cookieOptions(0),path:'/api/auth/google/callback'});
 return result;
}
