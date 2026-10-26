import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookieHeader, readSignedPayload, signPayload, randomSecret, cookieOptions } from '../../../../../lib/auth-server';
import { CANONICAL_APP_ORIGIN, safeInternalReturnTo } from '../../../../../lib/canonical-app';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const COOKIE = 'cypher-openrouter-consent';
const PATH = '/api/model-connections/openrouter';
const FLOW = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Binding = { flow_id: string; binding: string; sub: string; returnTo: string; exp: number };
type Context = { params: Promise<{ action: string }> };
const headers = { 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer' };

function returnPath(value: unknown) {
  const path = typeof value === 'string' ? safeInternalReturnTo(value) : null;
  return path && !/^\/(?:api|login|connect)(?:\/|\?|$)/.test(path) ? path : '/';
}
function session(request: NextRequest) { return getSessionFromCookieHeader(request.headers.get('cookie')); }
async function backend(request: NextRequest, path: string, body?: object) {
  const user = session(request);
  const base = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!user || !base) throw new Error('Sign in or wait for the connection service.');
  return fetch(new URL('/api/runtime/model-connections/openrouter/consent/'+path,base), {
    method: body ? 'POST' : 'GET', cache:'no-store', signal:AbortSignal.timeout(25000),
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(process.env.GROKBOT_BACKEND_API_TOKEN || ''),'x-grokbot-user-id':user.sub},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
}
function resultPage(status: string, flow?: Binding) {
  const url = new URL('/connect/models',CANONICAL_APP_ORIGIN);
  url.searchParams.set('result',status);
  if (flow) { url.searchParams.set('flow',flow.flow_id); url.searchParams.set('returnTo',returnPath(flow.returnTo)); }
  const result = NextResponse.redirect(url,303);
  Object.entries(headers).forEach(([name,value])=>result.headers.set(name,value));
  result.cookies.set(COOKIE,'',{...cookieOptions(0),path:PATH});
  return result;
}

export async function POST(request: NextRequest, context: Context) {
  if ((await context.params).action !== 'begin') return NextResponse.json({detail:'Not found.'},{status:404,headers});
  const user = session(request);
  if (!user) return NextResponse.json({detail:'Sign in before connecting a provider account.'},{status:401,headers});
  if (request.nextUrl.origin !== CANONICAL_APP_ORIGIN || request.headers.get('origin') !== CANONICAL_APP_ORIGIN)
    return NextResponse.json({detail:'Open the main Cypher address to connect this account.'},{status:403,headers});
  try {
    const body = await request.json();
    const binding = randomSecret();
    const response = await backend(request,'start',{binding});
    const data = await response.json();
    if (!response.ok) return NextResponse.json({detail:typeof data.detail === 'string'?data.detail:'The connection could not start.'},{status:response.status,headers});
    const url = new URL(data.authorization_url);
    if (!FLOW.test(data.flow_id) || url.origin !== 'https://openrouter.ai' || url.pathname !== '/auth' || url.username || url.password || url.searchParams.get('callback_url') !== CANONICAL_APP_ORIGIN+PATH+'/callback' || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') || '') || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') || '')) throw new Error('Invalid provider response');
    const flow: Binding = {flow_id:data.flow_id,binding,sub:user.sub,returnTo:returnPath(body.returnTo),exp:Math.floor(Date.now()/1000)+600};
    const result = NextResponse.json({authorization_url:url.href},{headers});
    result.cookies.set(COOKIE,signPayload(flow),{...cookieOptions(600),path:PATH});
    return result;
  } catch { return NextResponse.json({detail:'The account connection could not start. Your existing providers are unchanged.'},{status:503,headers}); }
}

export async function GET(request: NextRequest, context: Context) {
  const action = (await context.params).action;
  const user = session(request);
  if (action === 'status') {
    const id = request.nextUrl.searchParams.get('flow') || '';
    if (!user || !FLOW.test(id)) return NextResponse.json({detail:'Sign in to view this connection request.'},{status:401,headers});
    try {
      const response = await backend(request,id);
      return NextResponse.json(await response.json(),{status:response.status,headers});
    } catch { return NextResponse.json({detail:'Could not refresh the connection. The cloud check continues.'},{status:503,headers}); }
  }
  if (action !== 'callback') return NextResponse.json({detail:'Not found.'},{status:404,headers});
  let flow: Binding | null = null;
  try { flow = readSignedPayload<Binding>(request.cookies.get(COOKIE)?.value); } catch {}
  if (!user || !flow || flow.sub !== user.sub || !FLOW.test(flow.flow_id) || request.nextUrl.origin !== CANONICAL_APP_ORIGIN)
    return resultPage(user?'failed':'sign_in_required');
  const state = request.nextUrl.searchParams.get('state') || '';
  const denied = request.nextUrl.searchParams.has('error');
  // OpenRouter does not return state on denial. Never exchange without state.
  if (denied && !state) return resultPage('cancelled',flow);
  try {
    const response = await backend(request,'finish',{flow_id:flow.flow_id,binding:flow.binding,state,code:request.nextUrl.searchParams.get('code') || '',denied});
    const data = await response.json();
    return resultPage(response.ok && ['queued','cancelled'].includes(data.status)?data.status:'failed',flow);
  } catch { return resultPage('failed',flow); }
}
