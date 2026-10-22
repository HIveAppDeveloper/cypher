import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookieHeader } from '../../../lib/auth-server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function proxy(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const publicAuthPath = path === 'auth/email/request' || path === 'auth/email/verify' || (request.method==='GET' && /^workspace\/templates\/shared\/[A-Za-z0-9_-]{24,64}$/.test(path));
  const deviceIngress=request.method==='POST'&&['local-device/claim','local-device/poll','local-device/complete'].includes(path);
  const channelIngress = request.method === 'POST' && params.path.length === 3 && params.path[0] === 'channels' && params.path[2] === 'events';
  const session = getSessionFromCookieHeader(request.headers.get('cookie'));
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session && !publicAuthPath && !channelIngress && !deviceIngress) return NextResponse.json({ detail: 'Sign in to continue.' }, { status: 401 });
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ detail: 'Your cloud runtime is not connected. Open Workspace setup to connect it.' }, { status: 503 });
  const url = new URL('/api/' + params.path.map(encodeURIComponent).join('/'), backend);
  url.search = request.nextUrl.search;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.GROKBOT_BACKEND_API_TOKEN) headers.Authorization = `Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN}`;
  if (session) headers['x-grokbot-user-id'] = session.sub;
  const channelKey=request.headers.get('x-grokbot-channel-key');
  if(channelKey) headers['x-grokbot-channel-key']=channelKey;
  let response: Response;
  const timeout = params.path.join('/') === 'runtime/models/test' || params.path[0] === 'plugins' ? 60000 : 25000;
  try { response = await fetch(url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(), cache: 'no-store', signal: AbortSignal.timeout(timeout) }); } catch { return NextResponse.json({ detail: 'The cloud API is starting or unavailable. Try again shortly.' }, { status: 503 }); }
  if (params.path.join('/') === 'plugins/authorize' && response.ok) {
    const data=await response.json();
    const binding=data.binding; delete data.binding;
    const result=NextResponse.json(data,{status:response.status,headers:{'Cache-Control':'private, no-store'}});
    if(binding && data.flow_id)result.cookies.set('grokbot-oauth-'+data.flow_id,binding,{httpOnly:true,secure:true,sameSite:'lax',maxAge:600,path:'/api/plugin-oauth/callback'});
    return result;
  }
  const responseHeaders: Record<string, string> = { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const retryAfter=response.headers.get('retry-after');
  if(retryAfter)responseHeaders['Retry-After']=retryAfter;
  const disposition = response.headers.get('content-disposition');
  if (disposition) responseHeaders['Content-Disposition'] = disposition;
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
