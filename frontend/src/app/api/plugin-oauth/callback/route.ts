import { NextRequest,NextResponse } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  const state=request.nextUrl.searchParams.get('state')||'';
  const flow=state.split('.')[0];
  const origin=process.env.GROKBOT_PUBLIC_URL || 'https://open-grokbot-hiveapp.vercel.app';
  const redirect=new URL('/',origin);
  const binding=/^[0-9a-f-]{36}$/.test(flow)?request.cookies.get('grokbot-oauth-'+flow)?.value:undefined;
  const backend=process.env.BACKEND_INTERNAL_URL||process.env.GROKBOT_BACKEND_URL;
  let status='failed';
  if(binding && backend)try{
    const response=await fetch(new URL('/api/plugins/oauth/callback',backend),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.GROKBOT_BACKEND_API_TOKEN||''}`},body:JSON.stringify({state,binding,code:request.nextUrl.searchParams.get('code')||'',denied:request.nextUrl.searchParams.has('error'),issuer:request.nextUrl.searchParams.get('iss')}),cache:'no-store',signal:AbortSignal.timeout(60000)});
    const data=await response.json(); if(response.ok)status=data.status;
  }catch{}
  redirect.searchParams.set('plugins',status);
  const result=NextResponse.redirect(redirect,303);
  result.headers.set('Cache-Control','no-store'); result.headers.set('Referrer-Policy','no-referrer');
  result.cookies.set('grokbot-oauth-'+flow,'',{httpOnly:true,secure:true,sameSite:'lax',maxAge:0,path:'/api/plugin-oauth/callback'});
  return result;
}
