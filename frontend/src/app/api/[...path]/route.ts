import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromCookieHeader } from '../../../lib/auth-server';
import { pluginReturnPath } from '../../../lib/pluginAuthorization';
import { proxyServerTiming } from '../../../lib/server-timing';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const proxyStarted = performance.now();
  const { path: pathSegments } = await params;
  const path = pathSegments.join('/');
  if (request.method==='GET' && path==='plugin-oauth/client-metadata') {
    const origin=request.nextUrl.origin;
    const canonical='https://cypher-agent.vercel.app';
    const configured=(process.env.GROKBOT_PUBLIC_URL||canonical).replace(/\/$/,'');
    const origins=Array.from(new Set([canonical,configured,...(process.env.GROKBOT_OAUTH_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim().replace(/\/$/,'')).filter(Boolean)]));
    if(!origins.includes(origin))return NextResponse.json({detail:'Unknown app origin.'},{status:404});
    return NextResponse.json({client_id:origin+'/api/plugin-oauth/client-metadata',client_name:'Cypher',client_uri:origin,redirect_uris:origins.map(value=>value+'/api/plugin-oauth/callback'),grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},{headers:{'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
  }
  const publicAuthPath = path === 'auth/email/request' || path === 'auth/email/verify' || (request.method==='GET' && /^workspace\/templates\/shared\/[A-Za-z0-9_-]{24,64}$/.test(path));
  const deviceIngress=request.method==='POST'&&['local-device/claim','local-device/poll','local-device/complete'].includes(path);
  const channelIngress = request.method === 'POST' && pathSegments.length === 3 && pathSegments[0] === 'channels' && pathSegments[2] === 'events';
  const session = getSessionFromCookieHeader(request.headers.get('cookie'));
  if (process.env.REQUIRE_USER_AUTH === 'true' && !session && !publicAuthPath && !channelIngress && !deviceIngress) return NextResponse.json({ detail: 'Sign in to continue.' }, { status: 401 });
  const backend = process.env.BACKEND_INTERNAL_URL || process.env.GROKBOT_BACKEND_URL;
  if (!backend) return NextResponse.json({ detail: 'Your cloud runtime is not connected. Open Workspace setup to connect it.' }, { status: 503 });
  const url = new URL('/api/' + pathSegments.map(encodeURIComponent).join('/'), backend);
  url.search = request.nextUrl.search;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.GROKBOT_BACKEND_API_TOKEN) headers.Authorization = `Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN}`;
  if (session) headers['x-grokbot-user-id'] = session.sub;
  if(path==='google/mcp')for(const name of ['accept','mcp-protocol-version','mcp-session-id','last-event-id']){const value=request.headers.get(name);if(value)headers[name]=value;}
  if (path==='plugins/authorize') headers['x-grokbot-public-origin']=request.nextUrl.origin;
  const channelKey=request.headers.get('x-grokbot-channel-key');
  if(channelKey) headers['x-grokbot-channel-key']=channelKey;
  let response: Response;
  let upstreamStarted: number | undefined;
  let upstreamHeadersMs: number | undefined;
  const timeout = path === 'runtime/models/test' || pathSegments[0] === 'plugins' ? 60000 : 25000;
  try {
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    upstreamStarted = performance.now();
    response = await fetch(url, { method: request.method, headers, body, cache: 'no-store', signal: AbortSignal.timeout(timeout) });
    upstreamHeadersMs = performance.now() - upstreamStarted;
  } catch {
    const upstreamMs = upstreamStarted === undefined ? undefined : performance.now() - upstreamStarted;
    return NextResponse.json({ detail: 'The cloud API is starting or unavailable. Try again shortly.' }, {
      status: 503, headers: { 'Server-Timing': proxyServerTiming(upstreamMs, performance.now() - proxyStarted) },
    });
  }
  if (path === 'plugins/authorize' && response.ok) {
    const data=await response.json();
    const binding=data.binding; delete data.binding;
    const result=NextResponse.json(data,{status:response.status,headers:{'Cache-Control':'private, no-store'}});
    if(binding && /^[0-9a-f-]{36}$/.test(data.flow_id||'')){
      const options={httpOnly:true,secure:true,sameSite:'lax' as const,maxAge:600,path:'/api/plugin-oauth/callback'};
      result.cookies.set('grokbot-oauth-'+data.flow_id,binding,options);
      result.cookies.set('grokbot-oauth-return-'+data.flow_id,pluginReturnPath(request.headers.get('referer'),request.nextUrl.origin),options);
    }
    result.headers.set('Server-Timing', proxyServerTiming(upstreamHeadersMs, performance.now() - proxyStarted, response.headers.get('x-cypher-app-headers-ms')));
    return result;
  }
  const responseHeaders: Record<string, string> = { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const retryAfter=response.headers.get('retry-after');
  if(retryAfter)responseHeaders['Retry-After']=retryAfter;
  const disposition = response.headers.get('content-disposition');
  if (disposition) responseHeaders['Content-Disposition'] = disposition;
  responseHeaders['Server-Timing'] = proxyServerTiming(upstreamHeadersMs, performance.now() - proxyStarted, response.headers.get('x-cypher-app-headers-ms'));
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
