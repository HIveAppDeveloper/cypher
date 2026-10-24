import { NextRequest,NextResponse } from 'next/server';
import { getSessionFromCookieHeader } from '../../../../lib/auth-server';
import { pluginReturnPath } from '../../../../lib/pluginAuthorization';
function authHeaders(request:NextRequest):Record<string,string>{
  const session=getSessionFromCookieHeader(request.headers.get('cookie'));
  if(process.env.REQUIRE_USER_AUTH==='true' && !session)throw new Error('Sign in to continue.');
  return {'Content-Type':'application/json','Authorization':`Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN||''}`,...(session?{'x-grokbot-user-id':session.sub}:{})};
}
export const dynamic='force-dynamic';
export const maxDuration=90;
export async function GET(request:NextRequest){
  const state=request.nextUrl.searchParams.get('state')||'';
  const flow=state.split('.')[0];
  const origin=request.nextUrl.origin;
  const validFlow=/^[0-9a-f-]{36}$/.test(flow);
  const redirect=new URL(pluginReturnPath(validFlow?request.cookies.get('grokbot-oauth-return-'+flow)?.value||null:null,origin),origin);
  const binding=validFlow?request.cookies.get('grokbot-oauth-'+flow)?.value:undefined;
  const backend=process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL;
  let status='failed';
  if(binding && backend)try{
    const managed=request.nextUrl.searchParams.get('managed')==='1';
    const denied=request.nextUrl.searchParams.has('error');
    const body=managed?(denied?{flow_id:flow,binding}:{state,binding}):{state,binding,code:request.nextUrl.searchParams.get('code')||'',denied,issuer:request.nextUrl.searchParams.get('iss')};
    const path=managed?(denied?'/api/plugins/oauth/cancel':'/api/plugins/managed/callback'):'/api/plugins/oauth/callback';
    const response=await fetch(new URL(path,backend),{method:'POST',headers:authHeaders(request),body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)});
    const data=await response.json(); if(response.ok)status=data.status;
  }catch{}
  redirect.searchParams.set('plugins',status);
  if(validFlow)redirect.searchParams.set('plugin_flow',flow);
  const result=NextResponse.redirect(redirect,303);
  result.headers.set('Cache-Control','no-store'); result.headers.set('Referrer-Policy','no-referrer');
  if(validFlow)for(const prefix of ['grokbot-oauth-','grokbot-oauth-return-'])result.cookies.set(prefix+flow,'',{httpOnly:true,secure:true,sameSite:'lax',maxAge:0,path:'/api/plugin-oauth/callback'});
  return result;
}

export async function DELETE(request:NextRequest){
  const flow=request.nextUrl.searchParams.get('flow')||'';
  if(!/^[0-9a-f-]{36}$/.test(flow))return NextResponse.json({detail:'Invalid sign-in request.'},{status:400});
  const binding=request.cookies.get('grokbot-oauth-'+flow)?.value;
  const backend=process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL;
  if(!binding || !backend)return NextResponse.json({detail:'This sign-in request expired. Close this dialog and try again.'},{status:400});
  try{
    const response=await fetch(new URL('/api/plugins/oauth/cancel',backend),{method:'POST',headers:authHeaders(request),body:JSON.stringify({flow_id:flow,binding}),cache:'no-store',signal:AbortSignal.timeout(15000)});
    const result=NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
    if(response.ok)for(const prefix of ['grokbot-oauth-','grokbot-oauth-return-'])result.cookies.set(prefix+flow,'',{httpOnly:true,secure:true,sameSite:'lax',maxAge:0,path:'/api/plugin-oauth/callback'});
    return result;
  }catch{return NextResponse.json({detail:'Could not cancel sign-in. Try again.'},{status:503});}
}
